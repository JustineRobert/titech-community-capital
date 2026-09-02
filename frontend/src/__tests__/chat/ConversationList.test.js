import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import ConversationList from '../../pages/ConversationList';

const mockStore = configureStore([]);

test('renders empty state when no conversations', () => {
  const store = mockStore({ chat: { conversations: [] } });
  const { getByText } = render(
    <Provider store={store}>
      <ConversationList />
    </Provider>
  );
  expect(getByText(/No conversations yet/i)).toBeInTheDocument();
});

test('renders conversation items when present', () => {
  const store = mockStore({
    chat: { conversations: [{ id: '1', title: 'Test Conversation' }] },
  });
  const { getByText } = render(
    <Provider store={store}>
      <ConversationList />
    </Provider>
  );
  expect(getByText(/Test Conversation/i)).toBeInTheDocument();
});
