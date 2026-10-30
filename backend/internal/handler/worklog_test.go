package handler

import "testing"

func TestHourlyAmount(t *testing.T) {
	cases := []struct {
		name    string
		minutes int
		rate    float64
		want    float64
	}{
		{"整小时", 60, 200, 200},
		{"半小时", 30, 200, 100},
		{"一个半小时", 90, 200, 300},
		{"非整数工时", 45, 133, 99.75},
		{"金额保留到分", 1, 100, 1.67},
		{"没有工时", 0, 200, 0},
		{"没填时薪", 60, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hourlyAmount(c.minutes, c.rate); got != c.want {
				t.Fatalf("hourlyAmount(%d, %v) = %v, want %v", c.minutes, c.rate, got, c.want)
			}
		})
	}
}
