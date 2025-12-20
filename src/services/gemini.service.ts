import { Injectable, signal, WritableSignal } from '@angular/core';
import { GoogleGenAI, Modality } from '@google/genai';
import { from, map, Observable, of } from 'rxjs';
import { Article, Model, SearchIntent } from '../models/motor.models';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = environment.geminiApiKey;
    if (!apiKey || apiKey === 'REPLACE_WITH_REAL_API_KEY_IN_CI_OR_BUILD') {
      console.warn("API_KEY not configured. Gemini features will be disabled.");
    }
    this.ai = new GoogleGenAI({ apiKey });

    // Restore state from local storage
    const savedState = localStorage.getItem('ai_enabled');
    if (savedState !== null) {
      this.aiEnabled.set(savedState === 'true');
    }
  }

  aiEnabled: WritableSignal<boolean> = signal(true);

  toggleAi() {
    this.aiEnabled.update(v => !v);
    localStorage.setItem('ai_enabled', String(this.aiEnabled()));
  }

  rewriteArticle(title: string, content: string): Observable<string> {
    if (!this.aiEnabled()) return of(content); // Return original if disabled
    const prompt = this.getRewritePrompt(title, content);

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
    }));

    return response$.pipe(map(response => this.cleanResponse(response.text || '')));
  }

  rewriteArticleStream(title: string, content: string): Observable<string> {
    if (!this.aiEnabled()) return of(content);
    const prompt = this.getRewritePrompt(title, content);

    return new Observable<string>(observer => {
      let session: any = null;

      this.ai.live.connect({
        model: 'gemini-2.5-flash-live',
        config: {
          responseModalities: [Modality.TEXT],
        },
        callbacks: {
          onopen: () => {
            if (session) {
              session.sendClientContent({
                turns: [{
                  role: 'user',
                  parts: [{ text: prompt }]
                }],
                turnComplete: true
              });
            }
          },
          onmessage: (e: any) => {
            // LiveServerMessage has a helper getter 'text'
            const text = e.text;
            if (text) {
              observer.next(this.cleanResponse(text));
            }
            if (e.serverContent?.turnComplete) {
              observer.complete();
              session?.close();
            }
          },
          onclose: () => {
            observer.complete();
          },
          onerror: (err: any) => {
            observer.error(err);
          }
        }
      }).then(sess => {
        session = sess;
      }).catch(err => observer.error(err));

      return () => {
        if (session) {
          session.close();
        }
      };
    });
  }

  private getRewritePrompt(title: string, content: string): string {
    return `Rewrite the following automotive repair article to be clear, concise, and easy for a beginner DIYer to understand. 
    
    CRITICAL: You are an expert mechanic. Your goal is to IMPROVE FORMATTING without LOSING INFORMATION.
    
    1.  **PRESERVE Technical Details**: Do NOT remove specific warnings, "As-Built" vs "Read/Write" distinctions, or pre-requisite steps (e.g., "Read data BEFORE removing module"). Use the exact technical terms found in the original.
    2.  **PRESERVE Logical Sequence**: Do NOT reorder steps. If the original says "Do X before Y", you must keep that order.
    3.  **Tone**: Helpful and encouraging, but technically precise.

    CRITICAL FORMATTING INSTRUCTIONS:
    1.  **Structure**:
        *   **Summary**: A 1-sentence overview of the task.
        *   **Tools Needed**: A bulleted list <ul> of tools mentioned or typically required.
        *   **Important Warnings**: Use <div class="warning">...</div> for safety warnings.
        *   **Step-by-Step Guide**: Use an ordered list <ol> for the procedure.
        *   **Key Highlights**: Use <strong>tags</strong> for Part Numbers, Torque Specs, and Fluid Capacities.
        *   **Pro-Tips**: Use <div class="note">...</div> for helpful tips.
    
    2.  **HTML Requirements**:
        *   Use ONLY valid HTML tags: <h2>, <p>, <ul>, <ol>, <li>, <strong>, <div class="...">, <img>.
        *   **IMAGES**: Preserve all <img src="..."> tags EXACTLY as they appear in the original content. Do not modify the src attribute.
        *   Do NOT use Markdown.
    
    Original Content:
    ${content}`;
  }

  private cleanResponse(text: string): string {
    // Strip markdown code blocks
    return text.replace(/```html/g, '').replace(/```/g, '').trim();
  }

  analyzeSearchTerm(searchTerm: string, articles: Article[], topArticleContent: string = ''): Observable<string> {
    if (!this.aiEnabled()) return of('');
    const articleTitles = articles.map(a => `- ${a.title || a.code}`).join('\n');
    const prompt = `A user is searching for "${searchTerm}" for their vehicle. 
    
    I have provided the full content of the most relevant article below, along with a list of other available articles.
    
    **YOUR GOAL**:
    1. Answer the user's question DIRECTLY if the answer is in the "Top Article Content" (e.g., provide the specific torque spec, fluid type, or part number).
    2. If the specific answer is NOT in the content, provide a helpful summary based on the titles.
    
    **Top Article Content**:
    ${topArticleContent.substring(0, 15000)} <!-- Truncate to avoid token limits if massive -->
    
    **Other Available Articles**:
    ${articleTitles}
    
    Format the response as simple HTML.`;

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
    }));

    return response$.pipe(map(response => this.cleanResponse(response.text || '')));
  }

  findCommonIssues(vehicleName: string): Observable<import('../models/motor.models').CommonIssue[]> {
    if (!this.aiEnabled()) return of([]);
    const prompt = `Identify the top 3-5 most common reported mechanical problems for a ${vehicleName}.
    
    Output strictly as a JSON array of objects with this schema:
    [
      {
        "title": "Short title of the issue",
        "description": "Brief explanation of the problem.",
        "symptoms": ["List of 2-3 common symptoms"],
        "severity": "High" | "Medium" | "Low",
        "fixComplexity": "Easy" | "Moderate" | "Hard"
      }
    ]
    
    Ensure "severity" reflects safety/drivability impact.
    Ensure "fixComplexity" reflects DIY difficulty.`;

    const response$ = from(this.ai.models.generateContent({
      model: "gemini-2.5-flash-lite", // Flash-lite is sufficient and fast
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    }));

    return response$.pipe(map(response => {
      try {
        const text = response.text || '[]';
        return JSON.parse(text) as import('../models/motor.models').CommonIssue[];
      } catch (e) {
        console.error("Failed to parse common issues:", e);
        return [];
      }
    }));
  }

  generateSolution(issue: string, vehicleName: string, context: string = ''): Observable<string> {
    if (!this.aiEnabled()) return of('<p>AI generation is disabled.</p>');
    let prompt = `Generate a step-by-step guide for a beginner DIYer to diagnose and potentially fix the following issue on a ${vehicleName}: "${issue}". Provide a list of common tools that might be needed. Format the response as simple HTML.`;

    if (context) {
      prompt = `A user has reported the following issue on their ${vehicleName}: "${issue}".
      
      I have found a relevant technical article from the service manual. 
      **YOUR GOAL**: Create a beginner-friendly "How-To" guide based STRICTLY on the provided article content.
      
      **RULES**:
      1. Use the specific torque specs, fluid types, and part numbers from the article.
      2. Simplify the technical language for a DIYer, but do NOT lose important details like warnings or prerequisites.
      3. If the article contains a specific procedure (e.g., "Removal and Installation"), follow those steps.
      4. **FORMATTING**:
         - Use \`<h2>\` for major steps.
         - Use \`< div class="warning" > \` for safety warnings or disclaimers.
         - Use \`< div class="note" > \` for helpful tips or tools.
         - Do NOT use inline \`style = "..."\` attributes. Only use valid HTML tags and the classes above.
      
      **Article Content**:
      ${context.substring(0, 20000)}
      
      Format the response as specific HTML using the tags and classes defined above.`;
    }

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
    }));

    return response$.pipe(map(response => this.cleanResponse(response.text || '')));
  }

  analyzeSearchIntent(query: string, availableModels: string): Observable<SearchIntent> {
    if (!this.aiEnabled()) return of({ optimizedTerm: query, type: 'article_search', category: 'other' });
    const prompt = `You are a helpful automotive assistant. unique models available: ${availableModels}.
    Analyze the user's search query: "${query}"

    Determine the best search strategy.
    1.  **optimizedTerm**: The precise technical term to search for (e.g., "oil capacity", "brake rotor torque", "timing belt"). Keep it short.
    2.  **type**:
        *   'article_search': Default for specs, procedures, parts, info.
        *   'dtc_fetch': If query looks like a diagnostic code (P0300).
    3.  **category**: 'spec', 'procedure', 'part', 'dtc', or 'other'.

    Output JSON ONLY.
    Example: { "optimizedTerm": "engine oil capacity", "type": "article_search", "category": "spec" }`;

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    }));

    return response$.pipe(map(response => {
      try {
        const text = response.text || '{}';
        return JSON.parse(text) as SearchIntent;
      } catch (e) {
        console.error("Failed to parse intent:", e);
        return { optimizedTerm: query, type: 'article_search', category: 'other' }; // Fallback
      }
    }));
  }
}
