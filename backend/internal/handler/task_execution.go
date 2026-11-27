package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type taskExecutionReport struct {
	Summary      string   `json:"summary"`
	ChangedFiles []string `json:"changedFiles"`
	Checks       []string `json:"checks"`
	Artifacts    []string `json:"artifacts"`
	Risk         string   `json:"risk"`
}

type taskExecutionRecord struct {
	ID        string               `json:"id"`
	SessionID string               `json:"sessionId"`
	State     string               `json:"state"`
	StartedAt time.Time            `json:"startedAt"`
	EndedAt   *time.Time           `json:"endedAt,omitempty"`
	Error     string               `json:"error,omitempty"`
	Report    *taskExecutionReport `json:"report,omitempty"`
}

type taskAcceptanceItem struct {
	ID        string     `json:"id"`
	Text      string     `json:"text"`
	Checked   bool       `json:"checked"`
	CheckedAt *time.Time `json:"checkedAt,omitempty"`
	Note      string     `json:"note,omitempty"`
}

func decodeTaskExecutions(raw string) ([]taskExecutionRecord, error) {
	if strings.TrimSpace(raw) == "" {
		return []taskExecutionRecord{}, nil
	}
	var records []taskExecutionRecord
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		return nil, err
	}
	if records == nil {
		records = []taskExecutionRecord{}
	}
	return records, nil
}

func encodeTaskExecutions(records []taskExecutionRecord) (string, error) {
	if records == nil {
		records = []taskExecutionRecord{}
	}
	data, err := json.Marshal(records)
	return string(data), err
}

func loadTask(tx *gorm.DB, id uint) (model.Task, error) {
	var task model.Task
	err := tx.First(&task, id).Error
	return task, err
}

// StartTaskExecution creates the authoritative attempt record. Repeating the same
// key is idempotent; another key supersedes the current attempt.
func (h *Handler) StartTaskExecution(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var in struct {
		ExecutionID string `json:"executionId"`
		SessionID   string `json:"sessionId"`
	}
	if c.ShouldBindJSON(&in) != nil || strings.TrimSpace(in.ExecutionID) == "" || strings.TrimSpace(in.SessionID) == "" {
		badRequest(c, "executionId 与 sessionId 必填")
		return
	}
	var result taskExecutionRecord
	created := false
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		task, err := loadTask(tx, id)
		if err != nil {
			return err
		}
		records, err := decodeTaskExecutions(task.ExecutionsJSON)
		if err != nil {
			return err
		}
		if task.CurrentExecutionID == in.ExecutionID {
			for _, record := range records {
				if record.ID == in.ExecutionID && record.SessionID == in.SessionID && (record.State == "starting" || record.State == "running" || record.State == "waiting" || record.State == "turn-ended") {
					result = record
					return nil
				}
			}
			return errTaskExecutionConflict
		}
		if task.Status != "todo" && task.Status != "doing" {
			return errTaskExecutionConflict
		}
		for _, record := range records {
			if record.ID == in.ExecutionID {
				return errTaskExecutionConflict
			}
		}
		now := time.Now()
		created = true
		result = taskExecutionRecord{ID: in.ExecutionID, SessionID: in.SessionID, State: "starting", StartedAt: now}
		records = append(records, result)
		encoded, err := encodeTaskExecutions(records)
		if err != nil {
			return err
		}
		return tx.Model(&task).Updates(map[string]any{
			"status": "doing", "executor": "dsh", "session_id": in.SessionID,
			"run_state": "running", "last_run_at": &now, "current_execution_id": in.ExecutionID,
			"executions_json": encoded,
		}).Error
	})
	if err != nil {
		writeTaskExecutionError(c, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, gin.H{"ok": true, "execution": result})
}

var errTaskExecutionConflict = &taskExecutionError{status: http.StatusConflict, message: "任务状态已变化，请刷新后重试"}

type taskExecutionError struct {
	status  int
	message string
}

func (e *taskExecutionError) Error() string { return e.message }
func writeTaskExecutionError(c *gin.Context, err error) {
	if e, ok := err.(*taskExecutionError); ok {
		c.JSON(e.status, gin.H{"ok": false, "message": e.message})
		return
	}
	if err == gorm.ErrRecordNotFound {
		notFound(c, "任务不存在")
		return
	}
	serverErr(c, err)
}

func (h *Handler) UpdateTaskExecution(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	executionID := strings.TrimSpace(c.Param("executionId"))
	var in struct {
		State string `json:"state"`
		Error string `json:"error"`
	}
	if c.ShouldBindJSON(&in) != nil {
		badRequest(c, "参数错误")
		return
	}
	allowed := map[string]bool{"running": true, "waiting": true, "turn-ended": true, "failed": true, "stopped": true}
	if !allowed[in.State] {
		badRequest(c, "执行状态无效")
		return
	}
	err := h.mutateExecution(id, executionID, func(tx *gorm.DB, task *model.Task, record *taskExecutionRecord) error {
		if record.State == "handoff" || record.State == "stopped" || record.State == "failed" {
			return errTaskExecutionConflict
		}
		record.State = in.State
		record.Error = strings.TrimSpace(in.Error)
		if in.State == "failed" || in.State == "stopped" || in.State == "turn-ended" {
			now := time.Now()
			record.EndedAt = &now
		}
		updates := map[string]any{"run_state": in.State}
		return h.persistExecutionMutation(tx, task, record, updates)
	})
	if err != nil {
		writeTaskExecutionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) HandoffTaskExecution(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	executionID := strings.TrimSpace(c.Param("executionId"))
	var in struct {
		Report taskExecutionReport `json:"report"`
	}
	if c.ShouldBindJSON(&in) != nil || strings.TrimSpace(in.Report.Summary) == "" {
		badRequest(c, "交付摘要必填")
		return
	}
	err := h.mutateExecution(id, executionID, func(tx *gorm.DB, task *model.Task, record *taskExecutionRecord) error {
		if record.State == "handoff" && task.Status == "review" {
			return nil
		}
		if task.Status != "doing" {
			return errTaskExecutionConflict
		}
		if record.State == "handoff" {
			return nil
		}
		if record.State == "failed" || record.State == "stopped" {
			return errTaskExecutionConflict
		}
		report := in.Report
		record.Report = &report
		record.State = "handoff"
		now := time.Now()
		record.EndedAt = &now
		if err := h.persistExecutionMutation(tx, task, record, map[string]any{"run_state": "review", "status": "review"}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		writeTaskExecutionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RejectTaskExecution(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if c.ShouldBindJSON(&in) != nil {
		badRequest(c, "参数错误")
		return
	}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		task, err := loadTask(tx, id)
		if err != nil {
			return err
		}
		if task.Status != "review" {
			return errTaskExecutionConflict
		}
		records, err := decodeTaskExecutions(task.ExecutionsJSON)
		if err != nil {
			return err
		}
		for i := range records {
			if records[i].ID == task.CurrentExecutionID && records[i].State == "handoff" {
				records[i].State = "stopped"
			}
		}
		encoded, err := encodeTaskExecutions(records)
		if err != nil {
			return err
		}
		note := task.Note
		if reason := strings.TrimSpace(in.Reason); reason != "" {
			note = appendTaskNote(note, "打回原因："+reason)
		}
		return tx.Model(&task).Updates(map[string]any{"status": "doing", "run_state": "stopped", "current_execution_id": "", "note": note, "executions_json": encoded}).Error
	})
	if err != nil {
		writeTaskExecutionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) UpdateTaskAcceptance(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var in struct {
		Items []taskAcceptanceItem `json:"items"`
	}
	if c.ShouldBindJSON(&in) != nil {
		badRequest(c, "参数错误")
		return
	}
	seen := map[string]bool{}
	for i := range in.Items {
		item := &in.Items[i]
		item.ID = strings.TrimSpace(item.ID)
		item.Text = strings.TrimSpace(item.Text)
		if item.ID == "" || item.Text == "" || seen[item.ID] {
			badRequest(c, "验收项 id/text 必填且 id 不可重复")
			return
		}
		seen[item.ID] = true
		if item.Checked && item.CheckedAt == nil {
			now := time.Now()
			item.CheckedAt = &now
		}
		if !item.Checked {
			item.CheckedAt = nil
		}
	}
	data, err := json.Marshal(in.Items)
	if err != nil {
		serverErr(c, err)
		return
	}
	var task model.Task
	if err := h.DB.First(&task, id).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}
	if err := h.DB.Model(&task).Update("acceptance_json", string(data)).Error; err != nil {
		serverErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "items": in.Items})
}

func (h *Handler) ListTaskExecutions(c *gin.Context) {
	id, ok := paramUint(c, "id")
	if !ok {
		return
	}
	var task model.Task
	if err := h.DB.First(&task, id).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}
	records, err := decodeTaskExecutions(task.ExecutionsJSON)
	if err != nil {
		serverErr(c, err)
		return
	}
	acceptance := []taskAcceptanceItem{}
	if strings.TrimSpace(task.AcceptanceJSON) != "" {
		if err := json.Unmarshal([]byte(task.AcceptanceJSON), &acceptance); err != nil {
			serverErr(c, err)
			return
		}
	}
	if len(acceptance) == 0 && strings.TrimSpace(task.AcceptCriteria) != "" {
		for i, line := range strings.Split(task.AcceptCriteria, "\n") {
			text := strings.TrimSpace(line)
			if text == "" {
				continue
			}
			acceptance = append(acceptance, taskAcceptanceItem{ID: fmt.Sprintf("ac-%d", i), Text: text})
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "currentExecutionId": task.CurrentExecutionID, "items": records, "acceptance": acceptance})
}

func (h *Handler) mutateExecution(id uint, executionID string, mutate func(*gorm.DB, *model.Task, *taskExecutionRecord) error) error {
	return h.DB.Transaction(func(tx *gorm.DB) error {
		task, err := loadTask(tx, id)
		if err != nil {
			return err
		}
		if executionID == "" || task.CurrentExecutionID != executionID {
			return errTaskExecutionConflict
		}
		records, err := decodeTaskExecutions(task.ExecutionsJSON)
		if err != nil {
			return err
		}
		for i := range records {
			if records[i].ID != executionID {
				continue
			}
			if err := mutate(tx, &task, &records[i]); err != nil {
				return err
			}
			return nil
		}
		return errTaskExecutionConflict
	})
}

func (h *Handler) persistExecutionMutation(tx *gorm.DB, task *model.Task, record *taskExecutionRecord, updates map[string]any) error {
	records, err := decodeTaskExecutions(task.ExecutionsJSON)
	if err != nil {
		return err
	}
	for i := range records {
		if records[i].ID == record.ID {
			records[i] = *record
			break
		}
	}
	encoded, err := encodeTaskExecutions(records)
	if err != nil {
		return err
	}
	updates["executions_json"] = encoded
	if err := tx.Model(task).Updates(updates).Error; err != nil {
		return err
	}
	task.ExecutionsJSON = encoded
	return nil
}

func appendTaskNote(note, line string) string {
	if strings.TrimSpace(note) == "" {
		return line
	}
	return strings.TrimRight(note, "\r\n") + "\n" + line
}
