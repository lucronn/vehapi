import { Injectable } from '@angular/core';
import { Store, StoreConfig } from '@datorama/akita';

export enum ExpansionLevel {
  leftExpanded = 'leftExpanded',
  normal = 'normal',
  rightExpanded = 'rightExpanded',
}

export interface LayoutState {
  expansion: ExpansionLevel;
  /** Whether the user has ever selected an article to view. Used in determining whether to show the splash image.  */
  hasDisplayedContent: boolean;
}

const initialState: LayoutState = {
  expansion: ExpansionLevel.leftExpanded,
  hasDisplayedContent: false,
};

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'layout' })
export class LayoutStore extends Store<LayoutState> {
  constructor() {
    super(initialState);
  }
}
