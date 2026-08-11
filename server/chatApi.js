const respondChatError = (res, context, error) => {
  const statusCode =
    Number.isInteger(error?.statusCode) && error.statusCode >= 400
      ? error.statusCode
      : 500;
  if (statusCode >= 500) console.error(context, error);
  return res.status(statusCode).json({
    error:
      statusCode < 500 && error?.message
        ? error.message
        : "Chat is unavailable right now. Try again.",
  });
};

const assertChurchAccess = (req, res) => {
  if (
    !req.params.churchId ||
    req.appSession?.churchId !== req.params.churchId
  ) {
    res.status(403).json({ error: "That church chat is not available." });
    return false;
  }
  return true;
};

export const createChatHandlers = ({ chatService }) => ({
  async getContext(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const context = await chatService.getContext({
        churchId: req.params.churchId,
        session: req.appSession,
        timeZoneHint: req.query.timeZone,
      });
      res.json({ context });
    } catch (error) {
      respondChatError(res, "Error loading chat context:", error);
    }
  },

  async listMessages(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const result = await chatService.listMessages({
        churchId: req.params.churchId,
        session: req.appSession,
        dayKey: req.query.dayKey,
        timeZoneHint: req.query.timeZone,
        limit: req.query.limit,
        before: req.query.before,
      });
      res.json(result);
    } catch (error) {
      respondChatError(res, "Error loading chat messages:", error);
    }
  },

  async createMessage(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const message = await chatService.createMessage({
        churchId: req.params.churchId,
        session: req.appSession,
        text: req.body?.text,
        clientMessageId: req.body?.clientMessageId,
        timeZoneHint: req.body?.timeZone,
      });
      res.status(201).json({ message });
    } catch (error) {
      respondChatError(res, "Error sending chat message:", error);
    }
  },

  async updateMessage(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const message = await chatService.updateMessage({
        churchId: req.params.churchId,
        session: req.appSession,
        messageId: req.params.messageId,
        text: req.body?.text,
      });
      res.json({ message });
    } catch (error) {
      respondChatError(res, "Error updating chat message:", error);
    }
  },

  async deleteMessage(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const message = await chatService.deleteMessage({
        churchId: req.params.churchId,
        session: req.appSession,
        messageId: req.params.messageId,
      });
      res.json({ message });
    } catch (error) {
      respondChatError(res, "Error removing chat message:", error);
    }
  },

  async toggleReaction(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const message = await chatService.toggleReaction({
        churchId: req.params.churchId,
        session: req.appSession,
        messageId: req.params.messageId,
        emoji: req.body?.emoji,
      });
      res.json({ message });
    } catch (error) {
      respondChatError(res, "Error updating chat reaction:", error);
    }
  },

  stream(req, res) {
    if (!assertChurchAccess(req, res)) return;
    const dayKey = String(req.query.dayKey || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      res.status(400).json({ error: "Choose a valid chat date." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        churchId: req.params.churchId,
        dayKey,
      })}\n\n`,
    );

    const unsubscribe = chatService.subscribe({
      churchId: req.params.churchId,
      dayKey,
      onEvent: (event) => {
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (error) {
          console.error("Could not write chat SSE event:", error);
        }
      },
    });
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  },
});
