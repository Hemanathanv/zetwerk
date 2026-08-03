import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
    backgrounds: {
      default: 'EWMS page',
      values: [
        { name: 'EWMS page', value: 'hsl(30 20% 98%)' },
        { name: 'Card', value: '#ffffff' },
        { name: 'Dark', value: 'hsl(224 47% 8%)' },
      ],
    },
  },
};

export default preview;
