const AssistantService = require('../services/AssistantService');
const asyncHandler = require('../middleware/asyncHandler');

const assistantController = {
  // Lets the UI hide the chat when the server has no API key
  status: (req, res) => res.json({ success: true, data: { enabled: AssistantService.isEnabled() } }),

  chat: asyncHandler(async (req, res) => {
    const data = await AssistantService.chat(req.user, req.body);
    res.json({ success: true, data });
  })
};

module.exports = assistantController;
