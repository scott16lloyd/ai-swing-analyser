import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST() {
  try {
    // Get OpenAI API Key
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert golf swing analyst. Analyse the provided golf swing for posture, balance, and alignment, and suggest improvements based on professional golfers\' techniques.',
        },
        {
          role: 'user',
          content: [
            { type: "text", text: "You are an expert golf swing analyst. Analyse the provided golf swing data and image. Break down the swing into the following sections: 1. Address 2. Toe up 3. Top of the backswing 4. Downswing 5. Impact 6. Follow-through. For each section: - Provide a score out of 10 based on posture, balance, and alignment - Identify the strengths. - Highlight weaknesses. - Suggest specific improvements." },
        {
          type: "image_url",
          image_url: {
            "url": "https://gszhebbnuganylsxseuf.supabase.co/storage/v1/object/public/swing_images/Swing%20sequence%20photos%20anotated.png",
          },
        }
          ]
        },
      ],
    });

    return NextResponse.json(response.choices[0]);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
