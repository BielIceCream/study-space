import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Bold, Italic, Heading2, List, ListOrdered, ListChecks, Highlighter, Quote, Undo2, Redo2, Layers2, Check, Loader2, AlertCircle } from 'lucide-react';
import type { Note, RichDocument, SaveNoteInput, Subject } from '../../shared/types';
import { plural } from '../../shared/utils';
import { useNoteAutosave } from './use-note-autosave';

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  Placeholder.configure({ placeholder: 'Uma ideia, uma descoberta, uma pergunta… comece a escrever.' }),
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
];

export function NoteEditor({ note, subject, onSave, onCreateCard, registerFlush }: {
  note: Note; subject: Subject; onSave: (input: SaveNoteInput) => Promise<Note>;
  onCreateCard: (note: Note, selected: string) => void;
  registerFlush: (flush: () => Promise<void>, isDirty: () => boolean) => () => void;
}) {
  const autosave = useNoteAutosave(note, onSave, registerFlush);
  const [selected, setSelected] = useState('');
  const editor = useEditor({
    extensions,
    content: autosave.draft.bodyJson,
    editorProps: { attributes: { 'aria-label': 'Conteúdo da nota', 'role': 'textbox', 'aria-multiline': 'true', 'spellcheck': 'true' } },
    onUpdate: ({ editor: current }) => autosave.update({ bodyJson: current.getJSON() as RichDocument, plainText: current.getText() }),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      setSelected(current.state.doc.textBetween(from, to, '\n').trim());
    },
  });
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current?.isActive('bold'), italic: current?.isActive('italic'), heading: current?.isActive('heading'),
    bullet: current?.isActive('bulletList'), ordered: current?.isActive('orderedList'), task: current?.isActive('taskList'),
    highlight: current?.isActive('highlight'), quote: current?.isActive('blockquote'),
    undo: current?.can().undo(), redo: current?.can().redo(),
  }) });

  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(autosave.draft.bodyJson)) editor.commands.setContent(autosave.draft.bodyJson, { emitUpdate: false });
  }, [editor, autosave.draft.bodyJson]);

  const actions = [
    { label: 'Negrito', icon: Bold, active: state?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: 'Itálico', icon: Italic, active: state?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: 'Título de seção', icon: Heading2, active: state?.heading, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Lista com marcadores', icon: List, active: state?.bullet, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: 'Lista numerada', icon: ListOrdered, active: state?.ordered, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: 'Lista de tarefas', icon: ListChecks, active: state?.task, run: () => editor?.chain().focus().toggleTaskList().run() },
    { label: 'Destacar texto', icon: Highlighter, active: state?.highlight, run: () => editor?.chain().focus().toggleHighlight().run() },
    { label: 'Citação', icon: Quote, active: state?.quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
  ];
  const wordCount = autosave.draft.plainText.trim().split(/\s+/).filter(Boolean).length;
  const statusLabels = { saved: 'Salvo neste dispositivo', pending: 'Alterações pendentes', saving: 'Salvando…', error: 'Não foi possível salvar' };

  return <section className="note-editor">
    <div className="note-topline"><span className={`subject-pill accent-${subject.accent}`}><span className="color-dot" />{subject.name}</span>
      <span className={`save-status ${autosave.status}`} role="status">{autosave.status === 'saved' ? <Check size={14} /> : autosave.status === 'error' ? <AlertCircle size={14} /> : <Loader2 size={14} className="spin" />}{statusLabels[autosave.status]}</span>
    </div>
    {autosave.error && <div className="inline-alert" role="alert"><span>{autosave.error}</span><button className="text-button" onClick={() => void autosave.flush().catch(() => undefined)}>Tentar salvar</button></div>}
    {autosave.conflict && <div className="inline-alert"><span>Há um rascunho recuperado de uma edição anterior.</span><button className="text-button" onClick={autosave.recoverConflict}>Recuperar rascunho</button><button className="text-button" onClick={autosave.discardConflict}>Descartar rascunho</button></div>}
    {autosave.recovered && <p className="recovery-notice">Seu rascunho foi recuperado. Continue de onde parou.</p>}
    <input className="note-title" aria-label="Título da nota" placeholder="Sem título" maxLength={180} value={autosave.draft.title} onChange={event => autosave.update({ title: event.target.value })} />
    <div className="editor-toolbar" aria-label="Formatação da nota">
      <div className="format-actions">{actions.map(({ label, icon: Icon, active, run }) => <button type="button" key={label} className={`toolbar-button ${active ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={Boolean(active)} onClick={run}><Icon size={17} /></button>)}
        <span className="toolbar-divider" /><button className="toolbar-button" aria-label="Desfazer" title="Desfazer" disabled={!state?.undo} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></button><button className="toolbar-button" aria-label="Refazer" title="Refazer" disabled={!state?.redo} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></button>
      </div>
      <button className="button small soft" onClick={() => onCreateCard({ ...note, ...autosave.draft }, selected)} title={selected ? 'Criar um cartão com o texto selecionado' : 'Criar um cartão vinculado a esta nota'}><Layers2 size={16} />Criar cartão</button>
    </div>
    <EditorContent editor={editor} className="editor-content" />
    <div className="note-footer"><span>{plural(wordCount, 'palavra')}</span><span>Selecione um trecho para transformá-lo em flashcard.</span></div>
  </section>;
}
