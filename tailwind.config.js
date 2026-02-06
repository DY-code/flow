import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': 'var(--color-fg-default)',
            '--tw-prose-headings': 'var(--color-fg-default)',
            '--tw-prose-lead': 'var(--color-fg-muted)',
            '--tw-prose-links': 'var(--color-accent)',
            '--tw-prose-bold': 'var(--color-fg-default)',
            '--tw-prose-counters': 'var(--color-fg-muted)',
            '--tw-prose-bullets': 'var(--color-border)',
            '--tw-prose-hr': 'var(--color-border)',
            '--tw-prose-quotes': 'var(--color-fg-muted)',
            '--tw-prose-quote-borders': 'var(--color-border)',
            '--tw-prose-captions': 'var(--color-fg-muted)',
            '--tw-prose-code': 'var(--color-fg-default)',
            '--tw-prose-pre-code': 'var(--color-fg-default)',
            '--tw-prose-pre-bg': 'var(--color-bg-subtle)',
            maxWidth: 'none',
            color: 'var(--tw-prose-body)',
            p: {
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              textAlign: 'justify',
            },
            li: {
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              textAlign: 'justify',
            },
            h1: {
              fontWeight: '600',
              paddingBottom: '0.3em',
              borderBottom: '1px solid var(--color-border)',
              marginTop: '1.5em',
              marginBottom: '1rem',
            },
            h2: {
              fontWeight: '600',
              paddingBottom: '0.3em',
              borderBottom: '1px solid var(--color-border)',
              marginTop: '1.5em',
              marginBottom: '1rem',
            },
            h3: {
              fontWeight: '600',
              marginTop: '1.5em',
              marginBottom: '1rem',
            },
            'h4, h5, h6': {
              fontWeight: '600',
              marginTop: '1.5em',
              marginBottom: '1rem',
            },
            blockquote: {
              fontStyle: 'normal',
              borderLeftWidth: '0.25rem',
              color: 'var(--tw-prose-quotes)',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            code: {
              backgroundColor: 'var(--color-bg-code)',
              padding: '0.2em 0.4em',
              borderRadius: '6px',
              fontWeight: '400',
              fontSize: '85%',
              wordBreak: 'break-word',
            },
            pre: {
              backgroundColor: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              marginTop: '1rem',
              marginBottom: '1rem',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            },
            a: {
              textDecoration: 'none',
              fontWeight: '500',
              '&:hover': {
                textDecoration: 'underline',
              },
            },
            img: {
              borderRadius: '6px',
            },
            table: {
              marginTop: '1rem',
              marginBottom: '1rem',
            },
            'thead th': {
              textAlign: 'left',
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};
