package handler

import (
	"testing"
	"time"

	"personal-workbench/internal/model"
)

// 逾期判断是这个功能的命门：「中介说下个月结」到点没到账必须能自动暴露出来，
// 只靠人记性就会漏。所以边界要测干净。
func TestDecoratePayments(t *testing.T) {
	today := time.Now()
	day := func(off int) *time.Time {
		d := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, today.Location()).AddDate(0, 0, off)
		return &d
	}

	cases := []struct {
		name     string
		p        model.Payment
		wantLate bool
		wantDays int
	}{
		{
			name:     "约定日在过去 → 逾期",
			p:        model.Payment{Status: "pending", PlanDate: day(-15)},
			wantLate: true,
			wantDays: 15,
		},
		{
			name:     "约定日就是今天 → 还不算逾期",
			p:        model.Payment{Status: "pending", PlanDate: day(0)},
			wantLate: false,
		},
		{
			name:     "约定日还没到 → 不逾期",
			p:        model.Payment{Status: "pending", PlanDate: day(10)},
			wantLate: false,
		},
		{
			name:     "已到账的旧记录不算逾期",
			p:        model.Payment{Status: "received", PlanDate: day(-30)},
			wantLate: false,
		},
		{
			name:     "没填约定日就不判断",
			p:        model.Payment{Status: "pending", PlanDate: nil},
			wantLate: false,
		},
		{
			name:     "逾期一天",
			p:        model.Payment{Status: "pending", PlanDate: day(-1)},
			wantLate: true,
			wantDays: 1,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			items := []model.Payment{c.p}
			decoratePayments(items, defaultCreditDays)
			if items[0].Overdue != c.wantLate {
				t.Fatalf("Overdue = %v, want %v", items[0].Overdue, c.wantLate)
			}
			if c.wantLate && items[0].DaysLate != c.wantDays {
				t.Fatalf("DaysLate = %d, want %d", items[0].DaysLate, c.wantDays)
			}
		})
	}
}

// 时间带时分秒时不能因为「今天 00:00 < 现在」就误判成逾期
func TestDecoratePaymentsIgnoresTimeOfDay(t *testing.T) {
	now := time.Now()
	laterToday := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 0, 0, now.Location())
	items := []model.Payment{{Status: "pending", PlanDate: &laterToday}}
	decoratePayments(items, defaultCreditDays)
	if items[0].Overdue {
		t.Fatal("约定日是今天晚些时候，不该判成逾期")
	}
}

// 没填约定日、但记了确认收货日的，从确认收货那天起算账期。
// 「客户确认收货了但拖着不结」就靠这条兜底暴露出来。
func TestDecoratePaymentsByConfirmDate(t *testing.T) {
	day := func(off int) *time.Time {
		now := time.Now()
		d := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, off)
		return &d
	}
	const credit = 7

	t.Run("确认收货超过账期 → 逾期，逾期天数从推算到期日起算", func(t *testing.T) {
		items := []model.Payment{{Status: "pending", ConfirmDate: day(-9)}}
		decoratePayments(items, credit)
		if !items[0].Overdue || items[0].DaysLate != 2 {
			t.Fatalf("Overdue = %v, DaysLate = %d, want true/2", items[0].Overdue, items[0].DaysLate)
		}
	})

	t.Run("确认收货刚好满账期 → 还不算逾期", func(t *testing.T) {
		items := []model.Payment{{Status: "pending", ConfirmDate: day(-7)}}
		decoratePayments(items, credit)
		if items[0].Overdue {
			t.Fatal("账期最后一天不该判逾期")
		}
		if items[0].DueDate == nil {
			t.Fatal("DueDate 应该被推算出来")
		}
	})

	t.Run("填了约定日就以约定日为准，确认收货日只做兜底", func(t *testing.T) {
		items := []model.Payment{{Status: "pending", ConfirmDate: day(-30), PlanDate: day(5)}}
		decoratePayments(items, credit)
		if items[0].Overdue {
			t.Fatal("约定日还没到，不该判逾期")
		}
		if items[0].DueDate == nil || !items[0].DueDate.Equal(*items[0].PlanDate) {
			t.Fatalf("DueDate = %v, want 约定日 %v", items[0].DueDate, items[0].PlanDate)
		}
	})

	t.Run("已到账不算逾期", func(t *testing.T) {
		items := []model.Payment{{Status: "received", ConfirmDate: day(-30)}}
		decoratePayments(items, credit)
		if items[0].Overdue {
			t.Fatal("已到账不该判逾期")
		}
	})
}
