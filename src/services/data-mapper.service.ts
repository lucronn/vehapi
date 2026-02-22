import { Injectable } from '@angular/core';
import {
  NormalizedProcedure,
  NormalizedVehicle,
  NormalizedTSB,
  ProcedureStep
} from '../models/normalized_schema';
import {
  ArticleResponse,
  Article
} from '../models/motor.models';

@Injectable({
  providedIn: 'root'
})
export class DataMapperService {

  constructor() { }

  /**
   * Convert normalized DB procedure to API ArticleResponse
   */
  mapProcedureToArticleResponse(procedure: NormalizedProcedure): ArticleResponse {
    // Reconstruct HTML content from steps if original content isn't preserved
    // Ideally, we should store the raw HTML in the DB too if we want exact fidelity,
    // but here we might reconstruct it for the UI.
    // For now, let's assume the 'steps' JSON contains the HTML snippets or we check a 'content' field if added.

    // NOTE: In the schema, I added `content` to `articles` table but `procedures` table has `steps`.
    // If we use `procedures` table, we need to generate HTML.

    let contentHtml = '';
    if (procedure.steps && procedure.steps.length > 0) {
      contentHtml = `<div class="procedure-content">`;
      if (procedure.description) {
        contentHtml += `<p class="description">${procedure.description}</p>`;
      }
      contentHtml += `<ol>`;
      procedure.steps.sort((a, b) => a.order - b.order).forEach(step => {
        contentHtml += `<li>${step.text}`;
        if (step.image_url) {
          contentHtml += `<br><img src="${step.image_url}" />`;
        }
        contentHtml += `</li>`;
      });
      contentHtml += `</ol>`;
      contentHtml += `</div>`;
    }

    return {
      id: procedure.external_id || procedure.id || '',
      title: procedure.title,
      content: contentHtml,
      metadata: {
        timeEstimate: procedure.time_estimate_hours,
        tools: procedure.tools_required,
        parts: procedure.parts_required
      }
    };
  }

  /**
   * Convert API ArticleResponse to Normalized Procedure
   * This is the "AI Processing" part simulation.
   * In a real pipeline, this would involve LLM parsing.
   * Here, we do a basic extraction.
   */
  mapArticleResponseToProcedure(
    vehicleId: string,
    article: ArticleResponse,
    externalId: string
  ): NormalizedProcedure {
    // Basic extraction logic (placeholder for complex parsing)
    // We assume the content is HTML.

    const steps: ProcedureStep[] = [
      {
        order: 1,
        text: "Content imported from legacy system. See full view.",
        // In a real scenario, we would parse <ol><li> tags here.
      }
    ];

    return {
      vehicle_id: vehicleId,
      external_id: externalId,
      title: article.title,
      description: '', // extracted from subtitle if available
      steps: steps,
      tools_required: [],
      parts_required: [],
      time_estimate_hours: 0
    };
  }

  /**
   * Map Normalized TSB to ArticleResponse
   */
  mapTSBToArticleResponse(tsb: NormalizedTSB): ArticleResponse {
    return {
      id: tsb.bulletin_number,
      title: tsb.title,
      content: tsb.content || `<p>${tsb.summary || 'No content available.'}</p>`,
      metadata: {
        bulletinNumber: tsb.bulletin_number,
        issueDate: tsb.issue_date,
        affectedComponents: tsb.affected_components
      }
    };
  }
}
