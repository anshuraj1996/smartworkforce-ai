const { createAssistantTools } = require('../assistant/tools');
const { AppError, ValidationError } = require('../utils/errors');
const { todayStr } = require('../utils/dates');

// AI workforce assistant: answers questions in plain language using ONLY the tools in
// assistant/tools.js (role-scoped wrappers around existing services). The model never touches
// the database. Claude via the official Anthropic SDK, manual tool-use loop.
//
//   POST /api/v1/assistant/chat  { message, history? }  ->  { answer, toolsUsed, usage }
//
// Configuration (env):
//   ANTHROPIC_API_KEY    required to enable it (the endpoint answers 503 without it)
//   ASSISTANT_MODEL      default claude-opus-5-5
//   ASSISTANT_EFFORT     default low - short factual Q&A over tools doesn't need deep reasoning;
//                        raise to medium/high if answers to multi-step questions fall short
//
// Server-side refusal fallback is on ("default" routing): if the model declines a request on
// safety grounds, the API retries it on a fallback model inside the same call.

const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.ASSISTANT_EFFORT || 'low';
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 16000;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY = 10;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Stable across users and requests (cached prefix); per-user context goes in a second block
const SYSTEM_PROMPT = `You are the SmartWorkforce assistant inside a workforce-management app. You answer questions about attendance, leave, work from home, approvals, forecasts and workforce metrics.

How to work:
- Get facts from the tools. Never guess or invent names, numbers or dates. If no tool covers the question, say so briefly and mention what you can help with.
- Tools only return what the signed-in user is allowed to see. If a tool reports that something isn't permitted, explain that politely and don't try to get the data another way.
- Resolve relative dates yourself from today's date below (for example, "next week" is next Monday to Friday) and say which dates you used.
- You can't change anything - no approving, applying or editing. Point the user to the relevant page of the app instead.
- Risk scores are prompts for a supportive conversation, never judgments about a person. Say so whenever you mention them.

How to answer:
- Lead with the direct answer, then only the supporting numbers that matter.
- Use a short bullet list when listing several people or items; otherwise plain sentences.
- Keep it brief.`;

class AssistantError extends AppError {
  constructor(message, statusCode) {
    super(message, statusCode);
  }
}

function defaultClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  const Anthropic = require('@anthropic-ai/sdk'); // loaded only when the assistant is enabled
  return new Anthropic();
}

// SDK errors -> responses the user can act on (typed classes, never message matching)
function toAppError(error) {
  const Anthropic = require('@anthropic-ai/sdk');
  if (error instanceof Anthropic.RateLimitError) return new AssistantError('The assistant is busy right now - please try again in a minute.', 429);
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AssistantError('The assistant is not configured correctly (API credentials).', 503);
  }
  if (error instanceof Anthropic.APIConnectionError) return new AssistantError('The assistant could not be reached - please try again.', 502);
  if (error instanceof Anthropic.APIError) return new AssistantError('The assistant had a problem answering - please try again.', 502);
  return error;
}

class AssistantService {
  constructor({ tools, client, model = MODEL, effort = EFFORT, logger = console, today = todayStr }) {
    this.tools = tools;
    this.client = client === undefined ? defaultClient() : client;
    this.model = model;
    this.effort = effort;
    this.logger = logger;
    this.today = today;
  }

  isEnabled() {
    return Boolean(this.client);
  }

  userContext(user) {
    const today = this.today();
    const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
    return `Signed-in user: ${user.name || 'unknown'} (role: ${user.role}). Today is ${weekday}, ${today}.`;
  }

  // Earlier turns from the client, as plain text only (no tool calls or thinking), last N
  sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    const turns = history
      .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
      .slice(-MAX_HISTORY)
      .map(h => ({ role: h.role, content: h.content.slice(0, 4000) }));
    while (turns.length && turns[0].role !== 'user') turns.shift(); // must start with the user
    return turns;
  }

  async chat(user, { message, history = [] } = {}) {
    if (!this.isEnabled()) {
      throw new AssistantError('The AI assistant is not enabled on this server (ANTHROPIC_API_KEY is not set).', 503);
    }
    const question = typeof message === 'string' ? message.trim() : '';
    if (!question) throw new ValidationError('message is required');
    if (question.length > MAX_MESSAGE_CHARS) throw new ValidationError(`message can be at most ${MAX_MESSAGE_CHARS} characters`);

    const messages = [...this.sanitizeHistory(history), { role: 'user', content: question }];
    const toolDefinitions = this.tools.definitionsFor(user);
    const system = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: this.userContext(user) }
    ];
    const toolsUsed = [];
    const usage = { inputTokens: 0, outputTokens: 0, rounds: 0 };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      let response;
      try {
        response = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: MAX_TOKENS,
          output_config: { effort: this.effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          tools: toolDefinitions,
          messages
        });
      } catch (error) {
        throw toAppError(error);
      }
      usage.rounds += 1;
      usage.inputTokens += (response.usage && response.usage.input_tokens) || 0;
      usage.outputTokens += (response.usage && response.usage.output_tokens) || 0;

      // Safety classifiers declined even after the fallback - never run tools from that turn
      if (response.stop_reason === 'refusal') {
        return this.finish(user, "Sorry - I can't help with that request.", toolsUsed, usage, response.model);
      }
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return this.finish(user, text || "I couldn't find an answer to that.", toolsUsed, usage, response.model);
      }
      if (response.stop_reason === 'max_tokens') {
        // a tool call cut off mid-input must not run
        return this.finish(user, 'That question needs too much at once - please ask something narrower.', toolsUsed, usage, response.model);
      }

      // Keep the whole assistant turn (thinking blocks included, unchanged) and answer every
      // tool call in ONE user message
      messages.push({ role: 'assistant', content: response.content });
      const results = await Promise.all(toolUses.map(async (t) => {
        const result = await this.tools.execute(user, t.name, t.input || {});
        if (result.error) this.logger.error(`[assistant] tool ${t.name} failed: ${result.error.message}`);
        toolsUsed.push({ name: t.name, input: t.input, ok: !result.isError });
        return { type: 'tool_result', tool_use_id: t.id, content: result.content, ...(result.isError ? { is_error: true } : {}) };
      }));
      messages.push({ role: 'user', content: results });
    }

    return this.finish(user, "I couldn't finish answering that in a reasonable number of steps - please try a more specific question.", toolsUsed, usage, this.model);
  }

  finish(user, answer, toolsUsed, usage, model) {
    // Which data was used - no question/answer text in logs (it can contain personal data)
    this.logger.info(`[assistant] user ${user.id} (${user.role}): ${usage.rounds} round(s), tools [${toolsUsed.map(t => t.name).join(', ')}], tokens in ${usage.inputTokens} / out ${usage.outputTokens}`);
    return { answer, toolsUsed, model, usage };
  }
}

function buildDefault() {
  const repositories = require('../repositories');
  return new AssistantService({
    tools: createAssistantTools({
      leaveService: require('./LeaveService'),
      wfhService: require('./WfhService'),
      attendanceService: require('./AttendanceService'),
      workforceMetricsService: require('./WorkforceMetricsService'),
      workforceAnalyticsService: require('./WorkforceAnalyticsService'),
      forecastService: require('./ForecastService'),
      riskService: require('./RiskService'),
      analyticsRepository: repositories.analyticsRepository,
      userRepository: repositories.userRepository
    })
  });
}

module.exports = buildDefault();
module.exports.AssistantService = AssistantService;
module.exports.AssistantError = AssistantError;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
