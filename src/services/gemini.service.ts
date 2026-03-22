import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { from, map, Observable } from 'rxjs';
import { Article, Model } from '../models/motor.models';

declare const process: any;

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    let apiKey = '';
    try {
      if (typeof process !== 'undefined' && process?.env?.API_KEY) {
        apiKey = process.env.API_KEY;
      }
    } catch (e) {
      console.warn('Error accessing process.env.API_KEY', e);
    }
    
    if (!apiKey) {
      console.warn("API_KEY environment variable not set. Gemini features will be disabled.");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  rewriteArticle(title: string, content: string): Observable<string> {
    const prompt = `Rewrite the following automotive repair article to be clear, concise, and easy for a beginner DIYer to understand. Do not change any technical specifications, part numbers, or torque values. Ensure the tone is helpful and encouraging. The article is titled "${title}".\n\nOriginal Content:\n${content}`;
    
    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    }));
    
    return response$.pipe(map(response => response.text));
  }

  analyzeSearchTerm(searchTerm: string, articles: Article[]): Observable<string> {
    const articleTitles = articles.map(a => `- ${a.title || a.code}`).join('\n');
    const prompt = `A user is searching for "${searchTerm}" for their vehicle. Based on the following list of available repair articles, what are the most likely causes or relevant procedures? Provide a brief, helpful summary and mention the top 3-4 most relevant article titles. Format the response as simple HTML.\n\nAvailable Articles:\n${articleTitles}`;

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    }));

    return response$.pipe(map(response => response.text));
  }

  findCommonIssues(vehicleName: string): Observable<any> {
    const prompt = `What are the most common reported problems or issues for a ${vehicleName}? List the top 3-5 issues.`;
    
    const response$ = from(this.ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{googleSearch: {}}],
      },
    }));

    return response$.pipe(map(response => ({
        text: response.text,
        citations: response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    })));
  }

  generateSolution(issue: string, vehicleName: string): Observable<string> {
    const prompt = `Generate a step-by-step guide for a beginner DIYer to diagnose and potentially fix the following issue on a ${vehicleName}: "${issue}". Provide a list of common tools that might be needed. Format the response as simple HTML.`;

    const response$ = from(this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    }));

    return response$.pipe(map(response => response.text));
  }

  generateModelComparison(query: string, vehicleName: string, models: Model[], articles: Map<string, Article[]>): Observable<string> {
    let articleContext = '';
    articles.forEach((articleList, modelName) => {
        articleContext += `\n\nFor model "${modelName}":\n`;
        articleContext += articleList.map(a => `- Title: ${a.title}, ID: ${a.id}, Description: ${a.description || ''}, Bucket: ${a.bucket}`).join('\n');
    });

    const prompt = `A user has a ${vehicleName} but is unsure of the exact model. They want to know about "${query}".
    
    Based ONLY on the provided article data below, create an HTML table comparing the information for "${query}" across the different models. 
    
    The table should have a "Model" column and a column for the requested information (e.g., "Part Number", "Specification"). If the information isn't in the provided data for a specific model, state "Not found in provided articles". Do not invent any information.

    Available Article Data:
    ${articleContext}
    `;

    const response$ = from(this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
    }));

    return response$.pipe(map(response => response.text));
  }
}