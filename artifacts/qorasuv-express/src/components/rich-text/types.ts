/** Props of the rich-text editor. */
export interface RichEditorProps {
  /** HTML of one language. Read once on mount — remount (key) to load another value. */
  value: string;
  /** Fires with the editor's HTML; '' when the editor is empty. */
  onChange: (html: string) => void;
}
