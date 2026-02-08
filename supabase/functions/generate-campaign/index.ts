import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const TEXT_MODEL = "google/gemini-3-flash-preview";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

interface CampaignRequest {
  brandName: string;
  industry: string;
  theme: string;
  headlineText: string;
  visualStyle: string;
  brandColor: string;
  productImageBase64?: string;
  productImageMimeType?: string;
}

/** Shared helper to call the Lovable AI Gateway and handle common errors */
async function callGateway(
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error(`Gateway error [${resp.status}]:`, errBody);

    if (resp.status === 429) {
      throw Object.assign(new Error("Rate limit exceeded. Please try again shortly."), { status: 429 });
    }
    if (resp.status === 402) {
      throw Object.assign(new Error("AI credits exhausted. Please add credits."), { status: 402 });
    }
    throw Object.assign(new Error(`AI gateway error: ${resp.status}`), { status: 500 });
  }

  return resp;
}

/** Build an error Response with CORS */
function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const {
      brandName,
      industry,
      theme,
      headlineText,
      visualStyle,
      brandColor,
      productImageBase64,
      productImageMimeType,
    }: CampaignRequest = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // ============================
    // STEP 1: Analyze product image (if provided)
    // ============================
    let productContext = "";

    if (productImageBase64 && productImageMimeType) {
      console.log("Step 1: Analyzing product image with vision...");

      const visionResp = await callGateway(LOVABLE_API_KEY, {
        model: TEXT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert product analyst. Analyze this product image in detail. Describe the product, its colors, textures, materials, shape, and any notable features. Be specific and vivid so a text-to-image AI can recreate this product accurately in a new scene. Keep your description to 3-4 sentences.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${productImageMimeType};base64,${productImageBase64}`,
                },
              },
            ],
          },
        ],
      });

      const visionData = await visionResp.json();
      productContext = visionData.choices?.[0]?.message?.content || "";
      console.log("Product context:", productContext);
    }

    // ============================
    // STEP 2: Engineer image generation prompt
    // ============================
    console.log("Step 2: Engineering image generation prompt...");

    const styleDescriptions: Record<string, string> = {
      Photorealistic:
        "photorealistic product photography, studio lighting, dramatic shadows, crisp focus, commercial advertising quality",
      Neon: "neon lights, dark moody atmosphere, vibrant glowing colors, cyberpunk-inspired, electric accents, futuristic vibe",
      Pastel:
        "soft pastel colors, minimalist, clean, gentle gradients, calming aesthetic, airy whitespace",
      Luxury:
        "luxury, gold accents, rich textures, premium feel, elegant composition, dark tones, velvet-like depth",
    };

    const styleDesc =
      styleDescriptions[visualStyle] || styleDescriptions.Photorealistic;

    const productSection = productContext
      ? `\n\nIMPORTANT PRODUCT CONTEXT (from analyzing the uploaded product photo):\n${productContext}\nYou MUST incorporate this exact product into the scene as the hero element. The product should be large, centered or slightly off-center, and dominate the composition.`
      : "";

    const promptEngineerMessages = [
      {
        role: "system",
        content: `You are a world-class Graphic Designer and Prompt Engineer. You design professional marketing FLYER / POSTER images for social media ads. Your output is a single detailed prompt for an AI image generator.

DESIGN PHILOSOPHY (inspired by professional ad flyers):
- The product/subject is ALWAYS the hero — large, bold, and dominating the composition
- Typography is BIG, BOLD, and IMPACTFUL — use oversized display fonts, mix weights (heavy headlines + light subtext)
- The layout has clear visual hierarchy: hero text > product > supporting text > brand elements
- Use dramatic contrast between background and foreground
- Backgrounds should be rich, thematic, and context-appropriate (not plain/flat)
- Include subtle design elements: geometric shapes, accent stripes, circular badges for offers, diagonal cuts
- The overall feel should be polished, premium, and eye-catching — like a professional graphic designer made it in Photoshop

The image must:
1. Feature the text "${headlineText}" as MASSIVE, bold display typography — this is the most important visual element
2. Match the visual style: ${styleDesc}
3. Use ${brandColor} as the dominant brand accent color throughout
4. Be a ${theme}-themed ${industry} marketing flyer for "${brandName}"
5. Look like a professionally designed promotional flyer/poster, NOT a stock photo
6. Include a clear visual hierarchy with the headline text, product, and brand name "${brandName}"
7. Use dramatic composition with the product as the centerpiece

Rules:
- Output ONLY the prompt text, nothing else
- Do NOT use words like "generate" or "create" — describe the final design as if it exists
- The text "${headlineText}" MUST appear spelled correctly in huge bold typography
- The brand name "${brandName}" should appear smaller but clearly visible
- Keep the prompt under 250 words
- Describe: composition layout, background treatment, typography style/size/weight, lighting, color palette, decorative elements, and product placement
- Think of this as a flyer you'd see on Instagram or a billboard — bold, punchy, and impossible to scroll past`,
      },
      {
        role: "user",
        content: `Brand: ${brandName}
Industry: ${industry}
Theme/Occasion: ${theme}
Headline Text: "${headlineText}"
Visual Style: ${visualStyle}
Brand Color: ${brandColor}${productSection}

Design a professional marketing flyer prompt now.`,
      },
    ];

    const promptResp = await callGateway(LOVABLE_API_KEY, {
      model: TEXT_MODEL,
      messages: promptEngineerMessages,
    });

    const promptData = await promptResp.json();
    const imagenPrompt =
      promptData.choices?.[0]?.message?.content?.trim() || "";
    console.log("Engineered prompt:", imagenPrompt);

    if (!imagenPrompt) throw new Error("Failed to generate image prompt");

    // ============================
    // STEP 3: Generate image with Nano Banana
    // ============================
    console.log("Step 3: Generating image with Nano Banana (gemini-2.5-flash-image)...");

    const imageResp = await callGateway(LOVABLE_API_KEY, {
      model: IMAGE_MODEL,
      messages: [
        {
          role: "user",
          content: `Create a professional 1080x1080 square marketing flyer/poster design. This should look like it was made by a professional graphic designer — bold typography, dramatic composition, and polished layout.\n\n${imagenPrompt}`,
        },
      ],
      modalities: ["image", "text"],
    });

    const imageData = await imageResp.json();
    const imageUrl =
      imageData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      console.error(
        "Unexpected image response structure:",
        JSON.stringify(imageData).slice(0, 500)
      );
      throw new Error("No image was generated. Please try again.");
    }

    console.log("Image generated successfully (data URL length:", imageUrl.length, ")");

    // ============================
    // STEP 4: Generate matching caption
    // ============================
    console.log("Step 4: Generating social media caption...");

    let caption = "";
    try {
      const captionResp = await callGateway(LOVABLE_API_KEY, {
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert social media copywriter. Generate a compelling social media caption for a marketing post. The caption should:
1. Be engaging and on-brand
2. Include 2-3 relevant hashtags at the end
3. Be between 50-150 words
4. Match the tone of the campaign theme
5. Include a clear call to action
Output ONLY the caption text, nothing else.`,
          },
          {
            role: "user",
            content: `Brand: ${brandName}
Industry: ${industry}
Theme/Occasion: ${theme}
Main Headline: "${headlineText}"
Visual Style: ${visualStyle}

Write a matching social media caption.`,
          },
        ],
      });

      const captionData = await captionResp.json();
      caption = captionData.choices?.[0]?.message?.content?.trim() || "";
    } catch (captionErr) {
      console.warn("Caption generation failed, continuing without caption:", captionErr);
    }

    console.log("Campaign generation complete!");

    return new Response(
      JSON.stringify({
        imageUrl,
        caption,
        prompt: imagenPrompt,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    console.error("generate-campaign error:", e);
    const status = e?.status || 500;
    const message = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(message, status);
  }
});
