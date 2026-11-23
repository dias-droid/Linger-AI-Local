package app

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentregistry"
	api "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
)

func (a *App) listOwnAgentSkillBindings(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	inventory, err := a.agents.OwnSkillInventory(c.Request.Context(), a.agentAuth, token)
	if a.writeAgentAuthError(c, "list Skill bindings", err) {
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, inventory)
}

func (a *App) requestOwnAgentSkillUnbind(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	var request api.AgentSkillUnbindRequest
	if !a.decodeAgentRequest(c, &request) {
		return
	}
	if !agentregistry.AgentInvocationPattern.MatchString(request.InvocationId) || request.ExpectedBindingVersion < 1 || !agentregistry.SkillIDPattern.MatchString(request.SkillId) {
		a.writeAgentAPIError(c, http.StatusBadRequest, api.AgentApiErrorCodeInvalidRequest, "Provide a Skill ID and the binding version from teamhub skill list.")
		return
	}
	result, err := a.agents.PrepareOwnSkillUnbind(c.Request.Context(), a.agentAuth, token, request)
	if errors.Is(err, pgx.ErrNoRows) {
		a.writeAgentAPIError(c, http.StatusNotFound, api.AgentApiErrorCodeNotFound, "This Agent has no explicit binding for that Skill.")
		return
	}
	if a.writeAgentAuthError(c, "request Skill unbind", err) {
		return
	}
	a.writeAgentChange(c, request.InvocationId, result)
}
