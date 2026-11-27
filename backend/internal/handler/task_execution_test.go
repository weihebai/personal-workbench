package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"personal-workbench/internal/model"

	"github.com/gin-gonic/gin"
)

func newTaskExecutionRouter(t *testing.T) (*Handler, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h, _ := newTestHandler(t)
	r := gin.New()
	r.POST("/tasks/:id/executions", h.StartTaskExecution)
	r.PATCH("/tasks/:id/executions/:executionId", h.UpdateTaskExecution)
	r.POST("/tasks/:id/executions/:executionId/handoff", h.HandoffTaskExecution)
	r.POST("/tasks/:id/reject", h.RejectTaskExecution)
	r.PUT("/tasks/:id/acceptance", h.UpdateTaskAcceptance)
	r.GET("/tasks/:id/executions", h.ListTaskExecutions)
	return h, r
}

func createExecutionTask(t *testing.T, h *Handler, status string) model.Task {
	t.Helper()
	projectID := uint(1)
	task := model.Task{Title: "execution test", ProjectID: &projectID, Status: status, Priority: "normal", Kind: "personal"}
	if err := h.DB.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func requestJSON(t *testing.T, router http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	return response
}

func responseJSON(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v body=%s", err, response.Body.String())
	}
	return result
}

func TestTaskExecutionStartAndStateDoNotHandoffOnIdle(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	task := createExecutionTask(t, h, "todo")
	response := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("start status=%d body=%s", response.Code, response.Body.String())
	}
	var stored model.Task
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "doing" || stored.CurrentExecutionID != "exec-1" || stored.SessionID != "session-1" {
		t.Fatalf("start task state mismatch: %+v", stored)
	}

	response = requestJSON(t, router, http.MethodPatch, "/tasks/1/executions/exec-1", `{"state":"turn-ended"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("turn-ended status=%d body=%s", response.Code, response.Body.String())
	}
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "doing" {
		t.Fatalf("turn end must not handoff task; got %q", stored.Status)
	}
}

func TestTaskExecutionHandoffIsExplicitAndIdempotent(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	task := createExecutionTask(t, h, "todo")
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`)
	body := `{"report":{"summary":"implemented","changedFiles":["a.go"],"checks":["go test"],"artifacts":[],"risk":""}}`
	response := requestJSON(t, router, http.MethodPost, "/tasks/1/executions/exec-1/handoff", body)
	if response.Code != http.StatusOK {
		t.Fatalf("handoff status=%d body=%s", response.Code, response.Body.String())
	}
	var stored model.Task
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "review" {
		t.Fatalf("explicit handoff should enter review, got %q", stored.Status)
	}
	if !strings.Contains(stored.ExecutionsJSON, "implemented") {
		t.Fatalf("report not stored in execution history: %s", stored.ExecutionsJSON)
	}
	response = requestJSON(t, router, http.MethodPost, "/tasks/1/executions/exec-1/handoff", body)
	if response.Code != http.StatusOK {
		t.Fatalf("duplicate handoff should be idempotent, status=%d body=%s", response.Code, response.Body.String())
	}
	var after model.Task
	if err := h.DB.First(&after, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.ExecutionsJSON != stored.ExecutionsJSON {
		t.Fatal("duplicate handoff appended duplicate execution evidence")
	}
}

func TestTaskExecutionStaleEventCannotOverwriteRerun(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	task := createExecutionTask(t, h, "todo")
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-old","sessionId":"session-1"}`)
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/executions/exec-old/handoff", `{"report":{"summary":"first","checks":[],"changedFiles":[],"artifacts":[],"risk":""}}`)
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/reject", `{"reason":"needs changes"}`)
	response := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-new","sessionId":"session-1"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("new execution status=%d body=%s", response.Code, response.Body.String())
	}
	response = requestJSON(t, router, http.MethodPatch, "/tasks/1/executions/exec-old", `{"state":"failed","error":"late event"}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale event should conflict, status=%d body=%s", response.Code, response.Body.String())
	}
	var stored model.Task
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "doing" || stored.CurrentExecutionID != "exec-new" {
		t.Fatalf("stale event corrupted current task state: status=%s execution=%s", stored.Status, stored.CurrentExecutionID)
	}
}

func TestTaskAcceptanceIsSeparateFromAIReport(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	task := createExecutionTask(t, h, "todo")
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`)
	_ = requestJSON(t, router, http.MethodPost, "/tasks/1/executions/exec-1/handoff", `{"report":{"summary":"done","checks":["test passes"],"changedFiles":[],"artifacts":[],"risk":""}}`)
	response := requestJSON(t, router, http.MethodPut, "/tasks/1/acceptance", `{"items":[{"id":"ac-1","text":"test criterion","checked":true,"note":"verified by human"}]}`)
	if response.Code != http.StatusOK {
		t.Fatalf("acceptance status=%d body=%s", response.Code, response.Body.String())
	}
	var stored model.Task
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "review" || stored.DoneAt != nil {
		t.Fatalf("saving checks must not complete task: status=%s doneAt=%v", stored.Status, stored.DoneAt)
	}
	if stored.AcceptanceJSON == "" || stored.ExecutionsJSON == "" {
		t.Fatal("human acceptance and AI execution report must both be persisted separately")
	}
}

func TestTaskExecutionRejectsInvalidTransitionsAndDuplicateStartKey(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	createExecutionTask(t, h, "todo")
	startBody := `{"executionId":"exec-1","sessionId":"session-1"}`
	first := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", startBody)
	if first.Code != http.StatusCreated {
		t.Fatalf("first start=%d body=%s", first.Code, first.Body.String())
	}
	second := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", startBody)
	if second.Code != http.StatusOK {
		t.Fatalf("same active start should be idempotent, got %d", second.Code)
	}
	response := requestJSON(t, router, http.MethodPatch, "/tasks/1/executions/exec-1", `{"state":"failed","error":"failed"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("failed state=%d", response.Code)
	}
	response = requestJSON(t, router, http.MethodPost, "/tasks/1/executions/exec-1/handoff", `{"report":{"summary":"late handoff","checks":[],"changedFiles":[],"artifacts":[],"risk":""}}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("failed execution cannot handoff, got %d", response.Code)
	}
	response = requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("historical execution id cannot be reused, got %d", response.Code)
	}
}

func TestTaskExecutionNonDeliveryStatesKeepTaskInProgress(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	task := createExecutionTask(t, h, "todo")
	if response := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`); response.Code != http.StatusCreated {
		t.Fatalf("start=%d", response.Code)
	}
	for _, state := range []string{"waiting", "running", "turn-ended", "failed"} {
		response := requestJSON(t, router, http.MethodPatch, "/tasks/1/executions/exec-1", `{"state":"`+state+`"}`)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", state, response.Code, response.Body.String())
		}
		var stored model.Task
		if err := h.DB.First(&stored, task.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Status != "doing" {
			t.Fatalf("%s must not move the task column, got %q", state, stored.Status)
		}
	}
	var stored model.Task
	if err := h.DB.First(&stored, task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DoneAt != nil {
		t.Fatal("execution states must never complete the task")
	}
}

func TestTaskExecutionStateRejectsUnknownAndStaleIDs(t *testing.T) {
	h, router := newTaskExecutionRouter(t)
	createExecutionTask(t, h, "todo")
	response := requestJSON(t, router, http.MethodPost, "/tasks/1/executions", `{"executionId":"exec-1","sessionId":"session-1"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("start=%d", response.Code)
	}
	response = requestJSON(t, router, http.MethodPatch, "/tasks/1/executions/exec-1", `{"state":"completed"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown state should be rejected, got %d", response.Code)
	}
	response = requestJSON(t, router, http.MethodPost, "/tasks/1/executions/old/handoff", `{"report":{"summary":"stale"}}`)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale handoff should be rejected, got %d", response.Code)
	}
}
