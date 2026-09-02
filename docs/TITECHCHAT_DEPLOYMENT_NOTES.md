# TITechChat Deployment Notes

## Setup
- Ensure environment variables:
  - `JWT_SECRET`
  - `CLIENT_URL`
  - `SOCKET_PORT`
- Run migrations for Conversation and Message models
- Configure file upload utilities for attachments

## Realtime
- Socket.IO server initialized via `chatSocket.js`
- Auth handshake requires JWT
- Fallback to REST polling if socket unavailable

## Integration
- Register chat routes in `app.js`
- Add chatSlice to Redux store
- Update navigation to include TITechChat page

## Monitoring
- Audit logs reviewed regularly
- Error middleware captures and reports issues
- Notifications tested across modules
