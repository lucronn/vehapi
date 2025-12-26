import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";

@Injectable({
	providedIn: 'root'
})
export class ArticleToolboxService {
	
	constructor(
		private http: HttpClient
	) { }
	
  getContentFromUrl(url: string) {
    return this.http.get(url, { responseType: 'text' });
  }

}