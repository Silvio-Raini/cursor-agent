import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  if (!source.trim()) return '';
  return marked.parse(source, { async: false }) as string;
}
