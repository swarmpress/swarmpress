/**
 * Image Generation Service
 * AI-powered image generation using Google Gemini (Imagen)
 *
 * This service:
 * - Generates images from text prompts via Google's Imagen model
 * - Returns base64 image data (uploaded to permanent storage by caller)
 * - Supports different aspect ratios
 */

import { GoogleGenAI } from '@google/genai'

// =============================================================================
// TYPES
// =============================================================================

export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

export interface GenerateImageOptions {
  prompt: string
  aspectRatio?: ImageAspectRatio
  numberOfImages?: number
}

export interface GeneratedImage {
  buffer: Buffer           // Image data as buffer
  mimeType: string         // e.g., 'image/png'
  aspectRatio: ImageAspectRatio
}

export interface ImageGenerationResult {
  success: boolean
  images?: GeneratedImage[]
  error?: string
}

// =============================================================================
// IMAGE GENERATION SERVICE
// =============================================================================

export class ImageGenerationService {
  private client: GoogleGenAI | null = null

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey })
    }
  }

  /**
   * Check if the service is configured and ready
   */
  isConfigured(): boolean {
    return this.client !== null
  }

  /**
   * Generate images using Google Imagen
   *
   * @param options - Generation options
   * @returns Generated image buffers and metadata
   *
   * @example
   * const result = await imageGen.generate({
   *   prompt: "Sunset over Vernazza harbor with colorful fishing boats",
   *   aspectRatio: "16:9"
   * })
   */
  async generate(options: GenerateImageOptions): Promise<ImageGenerationResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Google API key not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.',
      }
    }

    const {
      prompt,
      aspectRatio = '16:9',  // Default to landscape (hero images)
      numberOfImages = 1,
    } = options

    try {
      console.log(`[ImageGeneration] Generating image with Imagen: "${prompt.slice(0, 50)}..."`)

      // Use Imagen 3 model for image generation
      const response = await this.client.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt,
        config: {
          numberOfImages,
          aspectRatio,
          outputMimeType: 'image/png',
        },
      })

      if (!response.generatedImages || response.generatedImages.length === 0) {
        return {
          success: false,
          error: 'No images returned from Imagen',
        }
      }

      const images: GeneratedImage[] = response.generatedImages
        .filter(img => img.image?.imageBytes)
        .map(img => ({
          buffer: Buffer.from(img.image!.imageBytes!, 'base64'),
          mimeType: 'image/png',
          aspectRatio,
        }))

      if (images.length === 0) {
        return {
          success: false,
          error: 'No valid images in response',
        }
      }

      console.log(`[ImageGeneration] Generated ${images.length} image(s) successfully`)

      return {
        success: true,
        images,
      }
    } catch (error) {
      console.error('[ImageGeneration] Error generating image:', error)

      // Handle specific Google API errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (errorMessage.includes('SAFETY')) {
        return {
          success: false,
          error: 'Content blocked by safety filters. Please modify your prompt.',
        }
      }

      if (errorMessage.includes('QUOTA') || errorMessage.includes('429')) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please try again later.',
        }
      }

      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return {
          success: false,
          error: 'Invalid or unauthorized Google API key.',
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Generate an image with automatic aspect ratio based on purpose
   *
   * @param prompt - Image description
   * @param purpose - Intended use of the image
   */
  async generateForPurpose(
    prompt: string,
    purpose: 'hero' | 'gallery' | 'thumbnail' | 'square' | 'portrait'
  ): Promise<ImageGenerationResult> {
    const aspectRatioMap: Record<string, ImageAspectRatio> = {
      hero: '16:9',       // Wide landscape for hero banners
      gallery: '4:3',     // Standard photo ratio
      thumbnail: '1:1',   // Square for thumbnails
      square: '1:1',
      portrait: '9:16',   // Tall for portrait layouts
    }

    return this.generate({
      prompt,
      aspectRatio: aspectRatioMap[purpose] || '16:9',
      numberOfImages: 1,
    })
  }

  /**
   * Build an optimized prompt for travel/destination imagery
   *
   * @param basePrompt - User's basic description
   * @param context - Additional context for better results
   */
  buildTravelPrompt(
    basePrompt: string,
    context?: {
      location?: string
      timeOfDay?: 'sunrise' | 'morning' | 'afternoon' | 'golden-hour' | 'sunset' | 'night'
      weather?: 'sunny' | 'cloudy' | 'dramatic-sky' | 'misty'
      style?: 'photorealistic' | 'artistic' | 'cinematic'
    }
  ): string {
    const parts = [basePrompt]

    if (context?.location) {
      parts.push(`in ${context.location}`)
    }

    if (context?.timeOfDay) {
      const timeDescriptions: Record<string, string> = {
        'sunrise': 'at sunrise with warm golden light',
        'morning': 'in soft morning light',
        'afternoon': 'in bright afternoon sunlight',
        'golden-hour': 'during golden hour with warm dramatic lighting',
        'sunset': 'at sunset with vibrant orange and pink sky',
        'night': 'at night with city lights reflecting',
      }
      parts.push(timeDescriptions[context.timeOfDay] || '')
    }

    if (context?.weather) {
      const weatherDescriptions: Record<string, string> = {
        'sunny': 'with clear blue sky',
        'cloudy': 'with soft diffused light from clouds',
        'dramatic-sky': 'with dramatic cloud formations',
        'misty': 'with atmospheric mist creating depth',
      }
      parts.push(weatherDescriptions[context.weather] || '')
    }

    if (context?.style) {
      const styleDescriptions: Record<string, string> = {
        'photorealistic': 'photorealistic, high quality photography, 8k resolution',
        'artistic': 'artistic interpretation, painterly style',
        'cinematic': 'cinematic composition, dramatic lighting, movie still quality',
      }
      parts.push(styleDescriptions[context.style] || 'photorealistic, high quality')
    } else {
      parts.push('photorealistic, high quality photography')
    }

    return parts.filter(Boolean).join(', ')
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let imageGenerationServiceInstance: ImageGenerationService | null = null

/**
 * Get or create the image generation service instance
 */
export function getImageGenerationService(): ImageGenerationService {
  if (!imageGenerationServiceInstance) {
    imageGenerationServiceInstance = new ImageGenerationService()
  }
  return imageGenerationServiceInstance
}

/**
 * Check if image generation is available
 */
export function isImageGenerationConfigured(): boolean {
  return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)
}
