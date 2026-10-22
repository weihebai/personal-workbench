package handler

import (
	"testing"

	"personal-workbench/internal/model"
)

func TestCommissionOf(t *testing.T) {
	cases := []struct {
		name string
		p    model.Project
		want float64
	}{
		{
			name: "不抽成",
			p:    model.Project{Quote: 10000, CommissionType: "none", CommissionRate: 20},
			want: 0,
		},
		{
			name: "按比例 20%",
			p:    model.Project{Quote: 10000, CommissionType: "pct", CommissionRate: 20},
			want: 2000,
		},
		{
			name: "按比例 30%",
			p:    model.Project{Quote: 20000, CommissionType: "pct", CommissionRate: 30},
			want: 6000,
		},
		{
			name: "固定金额 500",
			p:    model.Project{Quote: 6000, CommissionType: "fixed", CommissionRate: 500},
			want: 500,
		},
		{
			name: "抽成封顶在合同额，不能为负",
			p:    model.Project{Quote: 1000, CommissionType: "pct", CommissionRate: 200},
			want: 1000,
		},
		{
			name: "固定金额超过合同额也封顶",
			p:    model.Project{Quote: 300, CommissionType: "fixed", CommissionRate: 500},
			want: 300,
		},
		{
			name: "合同额为 0 不抽成",
			p:    model.Project{Quote: 0, CommissionType: "pct", CommissionRate: 20},
			want: 0,
		},
		{
			name: "比例填 0 不抽成",
			p:    model.Project{Quote: 10000, CommissionType: "pct", CommissionRate: 0},
			want: 0,
		},
		{
			name: "负数按 0 处理",
			p:    model.Project{Quote: 10000, CommissionType: "fixed", CommissionRate: -500},
			want: 0,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := commissionOf(&c.p); got != c.want {
				t.Fatalf("commissionOf() = %v, want %v", got, c.want)
			}
		})
	}
}

// 总览汇总必须与项目页逐项相加一致：固定抽成超过自身合同额时，
// 先汇总再封顶会把别的项目的额度「借」给它，算出偏大的抽成。
func TestSumCommissionUsesPerProjectCap(t *testing.T) {
	items := []model.Project{
		{Quote: 300, CommissionType: "fixed", CommissionRate: 500},
		{Quote: 10000, CommissionType: "pct", CommissionRate: 20},
		{Quote: 5000, CommissionType: "none"},
	}
	if got, want := sumCommission(items), 2300.0; got != want {
		t.Fatalf("sumCommission() = %v, want %v", got, want)
	}
}

func TestFillCommissionNetQuote(t *testing.T) {
	items := []model.Project{
		{Quote: 10000, CommissionType: "pct", CommissionRate: 20},
		{Quote: 5000, CommissionType: "none"},
	}
	fillCommission(items)
	if items[0].Commission != 2000 || items[0].NetQuote != 8000 {
		t.Fatalf("20%% 抽成应为 2000/8000，实际 %v/%v", items[0].Commission, items[0].NetQuote)
	}
	if items[1].Commission != 0 || items[1].NetQuote != 5000 {
		t.Fatalf("无抽成应为 0/5000，实际 %v/%v", items[1].Commission, items[1].NetQuote)
	}
}
