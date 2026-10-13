import { useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { useDarkTheme } from './use-dark-theme';

// The editor's minimum height, set on the text area itself, not only on the frame
// around it: with a short (or empty) text, a click in the frame below the last line
// would land outside the text area, and the browser would take the focus away
// instead of placing the cursor.
const MIN_HEIGHT = '220px';
const minHeightTheme = EditorView.theme({
  '.cm-content, .cm-gutter': { minHeight: MIN_HEIGHT },
});

/** The HTML tab: the same language's markup, editable as code. */
export default function HtmlSourceEditor({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Accessible name of the code area, e.g. "General conditions — English". */
  label: string;
}) {
  const dark = useDarkTheme();
  const extensions = useMemo(
    () => [
      html(),
      EditorView.lineWrapping,
      minHeightTheme,
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
    ],
    [label],
  );
  return (
    <div className="rich-source">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? 'dark' : 'light'}
        minHeight={MIN_HEIGHT}
        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
        style={{ fontSize: '12.5px' }}
      />
    </div>
  );
}
