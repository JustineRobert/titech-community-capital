import reducer, { setActiveConversation } from '../../store/chatSlice';

test('sets active conversation', () => {
  const initialState = { conversations: [], activeConversation: null, messages: {}, status: 'idle' };
  const action = setActiveConversation({ id: '123', title: 'Test' });
  const state = reducer(initialState, action);
  expect(state.activeConversation.id).toBe('123');
});
