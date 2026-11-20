// Which editor a popup belongs to: the toolbar's menus and boxes are drawn elsewhere on the page (in
// portals), so each is tagged with its editor's id, and the editor knows focus is still its own there.
import { createContext, useContext } from 'react'

export const EditorOwner = createContext('')

/** The attribute that tags a popup as this editor's. */
export function usePopupTag(): { 'data-editor-popup': string } {
  return { 'data-editor-popup': useContext(EditorOwner) }
}
