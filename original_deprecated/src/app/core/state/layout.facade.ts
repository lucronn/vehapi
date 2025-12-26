import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { combineLatest } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { UserSettingsService } from '../user-settings/user-settings.service';
import { LayoutQuery } from './layout.query';
import { ExpansionLevel, LayoutStore } from './layout.store';

@Injectable({ providedIn: 'root' })
export class LayoutFacade {
  constructor(
    private layoutStore: LayoutStore,
    private layoutQuery: LayoutQuery,
    private assetsFacade: AssetsFacade,
    public userSettings: UserSettingsService,
    @Inject(DOCUMENT) private doc: Document | null
  ) {
    combineLatest([this.assetsFacade.hasContentId$, userSettings.splashUrl$]).subscribe(([hasContentId, splashUrl]) => {
      if (hasContentId) {
        this.setExpansionLevel(ExpansionLevel.normal);
        this.layoutStore.update((state) => ({ ...state, hasDisplayedContent: true }));
      } else if (splashUrl && !this.layoutQuery.getValue().hasDisplayedContent) {
        this.setExpansionLevel(ExpansionLevel.normal);
      } else {
        this.setExpansionLevel(ExpansionLevel.leftExpanded);
      }
    });

    combineLatest([this.layoutQuery.select(), this.assetsFacade.activeArticleId$])
      .pipe(debounceTime(0))
      .subscribe(([currentLayout, activeArticleId]) => {
        const refElment = this.doc!.getElementById(activeArticleId!) as HTMLElement;
        setTimeout(() => {
          refElment?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 250);
      });
  }
  expansion$ = this.layoutQuery.select((s) => s.expansion);
  isLeftExpanded$ = this.expansion$.pipe(map((expansion) => expansion === ExpansionLevel.leftExpanded));
  isRightExpanded$ = this.expansion$.pipe(map((expansion) => expansion === ExpansionLevel.rightExpanded));
  hasDisplayedContent$ = this.layoutQuery.select((s) => s.hasDisplayedContent);
  isSplashImageVisible$ = combineLatest([this.assetsFacade.hasContentId$, this.userSettings.splashUrl$]).pipe(
    map(([hasDisplayedContent, splashUrl]) => !hasDisplayedContent && splashUrl)
  );

  getExpansionLevel() {
    return this.layoutQuery.getValue().expansion;
  }

  setExpansionLevel(expansion: ExpansionLevel) {
    this.layoutStore.update((state) => ({ ...state, expansion }));
  }

  toggleLeftExpandCollapse() {
    const currentExpansion = this.getExpansionLevel();
    if (currentExpansion === ExpansionLevel.normal) {
      this.setExpansionLevel(ExpansionLevel.leftExpanded);
    } else {
      this.setExpansionLevel(ExpansionLevel.normal);
    }
  }

  toggleRightExpandCollapse() {
    const currentExpansion = this.getExpansionLevel();
    if (currentExpansion === ExpansionLevel.normal) {
      this.setExpansionLevel(ExpansionLevel.rightExpanded);
    } else {
      this.setExpansionLevel(ExpansionLevel.normal);
    }
  }
}
