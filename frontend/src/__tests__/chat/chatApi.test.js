import axios from 'axios';
import chatApi from '../../services/chatApi';

jest.mock('axios');

test('fetches conversations', async () => {
  axios.get.mockResolvedValue({ data: { data: [{ id: '1', title: 'Test' }] } });
  const result = await chatApi.getConversations();
  expect(result[0].title).toBe('Test');
});

test('sends message', async () => {
  axios.post.mockResolvedValue({ data: { data: { id: '1', body: 'Hello' } } });
  const result = await chatApi.sendMessage('1', 'Hello');
  expect(result.body).toBe('Hello');
});
