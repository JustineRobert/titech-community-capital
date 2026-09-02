# TITechChat API

## Endpoints

### Conversations
- `POST /api/chat/conversation` → Create a conversation
- `GET /api/chat/conversations` → List user conversations
- `GET /api/chat/conversation/:id` → Get conversation details
- `GET /api/chat/conversation/:id/messages` → Fetch messages
- `POST /api/chat/conversation/:conversationId/pin/:messageId` → Pin a message
- `POST /api/chat/conversation/:id/archive` → Archive a conversation

### Messages
- `POST /api/chat/message` → Send a message
- `PUT /api/chat/message/:id` → Edit a message
- `DELETE /api/chat/message/:id` → Soft delete a message
- `GET /api/chat/messages/search?q=...` → Search messages

## Response Format
All responses follow:
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional status message"
}

