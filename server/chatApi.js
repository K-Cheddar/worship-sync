const respondChatError = (res, context, error) => {
  let statusCode =
    Number.isInteger(error?.statusCode) && error.statusCode >= 400
      ? error.statusCode
      : 500;
  if (error?.name === "NotFound" || error?.name === "NoSuchKey") {
    statusCode = 404;
  }
  if (statusCode >= 500) console.error(context, error);
  let message = "Could not complete that chat request. Try again.";
  if (statusCode < 500 && error?.message) message = error.message;
  if (error?.name === "NotFound" || error?.name === "NoSuchKey") {
    message = "The uploaded photo was not found. Add it again and try again.";
  }
  return res.status(statusCode).json({
    error: message,
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

export const createChatHandlers = ({ chatService, getChatImageStorage }) => ({
  async getContext(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const context = await chatService.getContext({
        churchId: req.params.churchId,
        session: req.appSession,
        timeZoneHint: req.query.timeZone,
      });
      let imageUploadsEnabled = false;
      if (getChatImageStorage) {
        try {
          getChatImageStorage();
          imageUploadsEnabled = true;
        } catch (error) {
          if (error?.statusCode !== 503) {
            console.error("Error checking chat image storage:", error);
          }
        }
      }
      res.json({ context: { ...context, imageUploadsEnabled } });
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
    if (!assertChurchAccess(req, res)) {
      res.locals?.releaseChatImageFinalize?.();
      return;
    }
    try {
      const message = await chatService.createMessage({
        churchId: req.params.churchId,
        session: req.appSession,
        text: req.body?.text,
        clientMessageId: req.body?.clientMessageId,
        timeZoneHint: req.body?.timeZone,
        completeAttachment: req.body?.imageUpload
          ? () =>
              getChatImageStorage().completeUpload({
                churchId: req.params.churchId,
                actorId: req.appSession.actorId,
                clientMessageId: req.body?.clientMessageId,
                upload: req.body.imageUpload,
              })
          : undefined,
      });
      res.status(201).json({ message });
    } catch (error) {
      respondChatError(res, "Error sending chat message:", error);
    } finally {
      res.locals?.releaseChatImageFinalize?.();
    }
  },

  async createImageUpload(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const result = await getChatImageStorage().createUpload({
        churchId: req.params.churchId,
        actorId: req.appSession.actorId,
        upload: req.body,
      });
      res.status(201).json(result);
    } catch (error) {
      respondChatError(res, "Error creating chat image upload:", error);
    }
  },

  async uploadImageFromApp(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const result = await getChatImageStorage().createUploadFromBuffer({
        churchId: req.params.churchId,
        actorId: req.appSession.actorId,
        upload: {
          fileName: req.query.fileName,
          contentType: req.get("content-type"),
        },
        body: req.body,
      });
      res.status(201).json(result);
    } catch (error) {
      respondChatError(res, "Error uploading chat image from app:", error);
    }
  },

  async getImageUrl(req, res) {
    if (!assertChurchAccess(req, res)) return;
    const variant = String(req.params.variant || "").trim();
    if (variant !== "full" && variant !== "thumbnail") {
      res.status(400).json({ error: "Choose a valid photo size." });
      return;
    }
    try {
      const attachment = await chatService.getImageAttachment({
        churchId: req.params.churchId,
        messageId: req.params.messageId,
      });
      const result = await getChatImageStorage().getDownloadUrl({
        churchId: req.params.churchId,
        attachment,
        variant,
      });
      res.json(result);
    } catch (error) {
      respondChatError(res, "Error loading chat image URL:", error);
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

  async updateTyping(req, res) {
    if (!assertChurchAccess(req, res)) return;
    try {
      const typing = await chatService.updateTyping({
        churchId: req.params.churchId,
        session: req.appSession,
        isTyping: req.body?.isTyping,
        timeZoneHint: req.body?.timeZone,
      });
      res.json({ typing });
    } catch (error) {
      respondChatError(res, "Error updating chat typing state:", error);
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
