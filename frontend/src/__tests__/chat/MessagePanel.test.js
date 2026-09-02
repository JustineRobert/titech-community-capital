import React from 'react';
import { render } from '@testing-library/react';
import MessagePanel from '../../components/chat/MessagePanel';

test('renders message panel with composer', () => {
  const { getByPlaceholderText } = render(<MessagePanel conversation={{ id: '1' }} />);
  expect(getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
});
