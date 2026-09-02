import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import ConversationDetail from '../../pages/ConversationDetail';

const mockStore = configureStore([]);

test('shows prompt when no active conversation', () => {
  const store = mockStore({ chat: { activeConversation: null } });
  const { getByText } = render(
    <Provider store={store}>
      <ConversationDetail />
    </Provider>
  );
  expect(getByText(/Select a conversation/i)).toBeInTheDocument();
});
