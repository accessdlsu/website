import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { PDFDocument, rgb, StandardFonts, RotationTypes } from 'pdf-lib';

// Simple in-memory cache for rate limiting (per user)
const downloadCountCache: Record<string, number> = {}; // id -> download count
const rateLimitTriggeredCache: Record<string, number> = {}; // id -> timestamp when rate limit was triggered
const gDriveCache: Record<string, { filename: string, buffer: Buffer, timestamp: number }> = {};

// Helper to get Google Access Token (same as in route.ts)
async function getGoogleAccessToken() {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat,
  };

  function base64url(input: string) {
    return btoa(input)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  const enc = (obj: unknown) => base64url(JSON.stringify(obj));
  const unsignedToken = `${enc(header)}.${enc(payload)}`;

  // Import private key
  function str2ab(str: string) {
    try {
      // Handle JSON-escaped format and remove surrounding quotes
      let processedKey = str;

      // Remove surrounding quotes if present (Cloudflare JSON string format)
      if (processedKey.startsWith('"') && processedKey.endsWith('"')) {
        processedKey = processedKey.slice(1, -1);
      }

      // Convert JSON-escaped newlines to actual newlines
      if (processedKey.includes('\\n')) {
        processedKey = processedKey.replace(/\\n/g, '\n');
      }

      // Split by newlines and filter out header/footer lines
      const lines = processedKey.split('\n');
      const base64Lines = lines.filter(line => !line.startsWith('-----'));
      const cleaned = base64Lines.join('').trim();

      const bstr = atob(cleaned);
      const buf = new ArrayBuffer(bstr.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < bstr.length; i++) view[i] = bstr.charCodeAt(i);
      return buf;
    } catch (error) {
      console.error('Invalid private key format:', error);
      throw new Error('Invalid Google Drive private key configuration');
    }
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    str2ab(process.env.GOOGLE_DRIVE_PRIVATE_KEY!),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );

  function ab2b64url(buf: ArrayBuffer) {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return base64url(bin);
  }

  const jwt = `${unsignedToken}.${ab2b64url(signature)}`;

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('Google OAuth error:', res.status, res.statusText);
    console.error('Error response:', errorText);
    throw new Error(`Google OAuth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    console.error('No access token in response:', data);
    throw new Error('Failed to get Google access token');
  }
  return data.access_token;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();

  // Get user info from auth session
  let userInfo;
  try {
    const sessionToken = cookieStore.get('authjs.session-token')?.value || cookieStore.get('__Secure-authjs.session-token')?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: 'Unauthorized (Please sign in)' }, { status: 401 });
    }

    // For NextAuth, we need to get the session differently
    // This is a simplified version - you might need to decode the session properly
    const user = cookieStore.get('user_info')?.value;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized (User info not found)' }, { status: 401 });
    }

    const userData = JSON.parse(user);
    userInfo = {
      id: userData.email?.replace(/[^a-zA-Z0-9]/g, '_') || '0',
      name: userData.name || 'Unknown User',
      email: userData.email || 'unknown@email.com'
    };
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: Allow unlimited downloads until 30, then 1 hour cooldown
  const now = Date.now();
  const userId = userInfo.id;

  // Get current download count from cache
  let downloadCount = downloadCountCache[userId] || 0;

  // Get rate limit trigger timestamp from cache
  const rateLimitTriggered = rateLimitTriggeredCache[userId] || 0;

  // Check if user is currently rate limited
  if (rateLimitTriggered && now - rateLimitTriggered < 60 * 60 * 1000) { // 1 hour cooldown
    const waitMinutes = Math.ceil((60 * 60 * 1000 - (now - rateLimitTriggered)) / 60000);
    return NextResponse.json(
      { error: `Rate limit: You have downloaded 30 resources. Please wait ${waitMinutes} more minute(s) before downloading again.` },
      { status: 429 }
    );
  }

  // If cooldown has passed, reset the count and trigger timestamp
  if (rateLimitTriggered && now - rateLimitTriggered >= 60 * 60 * 1000) {
    downloadCount = 0;
    delete rateLimitTriggeredCache[userId];
  }

  // Check if this download would trigger rate limiting
  if (downloadCount >= 30) {
    rateLimitTriggeredCache[userId] = now;
    const waitMinutes = 60; // 1 hour
    return NextResponse.json(
      { error: `Rate limit: Please wait ${waitMinutes} more minute(s) before downloading again.` },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const encodedFileId = searchParams.get('fileId');

  if (!encodedFileId) {
    return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
  }

  const downloadDate = new Date();

  // Decode the file ID
  let fileId;
  try {
    fileId = atob(encodedFileId);
  } catch (error) {
    console.error('Invalid base64 fileId:', encodedFileId, error);
    return NextResponse.json({ error: 'Invalid file ID format' }, { status: 400 });
  }

  let originalPDF, filename;
  const cachedFile = gDriveCache[fileId];

  if (cachedFile && now - cachedFile.timestamp < 60 * 60 * 1000) {
    console.log('Using file in cache');
    originalPDF = cachedFile.buffer;
    filename = cachedFile.filename;
  } else {
    const accessToken = await getGoogleAccessToken();
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      console.error('Error downloading from Google Drive:', await res.text());
      return NextResponse.json({ error: 'Failed to download file' }, { status: res.status });
    }

    // Get the file content
    originalPDF = Buffer.from(await res.arrayBuffer());

    // Get file metadata to get the filename
    const metadataUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`;
    const metadataRes = await fetch(metadataUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const metadata = (await metadataRes.json()) as { name?: string };
    filename = metadata.name || `ACCESS_Resource_${encodedFileId}_${downloadDate.toLocaleString('sv')}.pdf`;

    // Cache the file
    gDriveCache[fileId] = {
      filename,
      buffer: originalPDF,
      timestamp: now
    };
  }

  // Check if file is PDF - only watermark PDFs
  const isPDF = filename.toLowerCase().endsWith('.pdf');
  let finalFile = originalPDF;

  if (isPDF) {
    console.log('Adding watermark to PDF');
    try {
      finalFile = await addWatermark(originalPDF, userInfo, downloadDate);
    } catch (error) {
      console.error('Error watermarking PDF:', error);
      // If watermarking fails, return original file
    }
  }

  // Convert Buffer to Uint8Array for NextResponse compatibility
  const responseBody = new Uint8Array(finalFile);

  const response = new NextResponse(responseBody, {
    headers: {
      'Content-Type': isPDF ? 'application/pdf' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': finalFile.length.toString(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    },
  });

  // After successful download, update download count
  downloadCountCache[userId] = downloadCount + 1;

  // Store user info in cookie for future requests
  response.cookies.set('user_info', JSON.stringify(userInfo), {
    maxAge: 60 * 60, // 1 hour
    httpOnly: true,
    sameSite: 'strict',
    path: '/'
  });

  return response;
}

/**
 * Add watermark to PDF
 * @param {Buffer} pdfBuffer - Original PDF buffer
 * @param {Object} userInfo - User information for watermark
 * @param {string} userInfo.name - User's display name
 * @param {string} userInfo.email - User's email address
 * @returns {Promise<Buffer>} - Watermarked PDF buffer
 */
async function addWatermark(pdfBuffer: Buffer, userInfo: { id: string, name: string, email: string }, downloadDate: Date) {
  try {
    // Load the PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Watermark text
    const watermarkText = `${userInfo.name} • ${userInfo.email}`;
    const fontSize = 8;
    const textColor = rgb(0.6, 0.6, 0.6); // Gray color

    // Current timestamp for download tracking
    const downloadDateString = downloadDate.toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Add watermark to each page
    pages.forEach((page, index) => {
      const { width, height } = page.getSize();

      // Calculate text dimensions
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
      const timeWidth = font.widthOfTextAtSize(`Downloaded: ${downloadDateString}`, fontSize - 1);

      // Margins
      const margin = 20;

      // === BOTTOM RIGHT WATERMARK ===
      const bottomX = width - Math.max(textWidth, timeWidth) - margin;
      const bottomY = margin;

      // Add user info watermark (bottom right)
      page.drawText(watermarkText, {
        x: bottomX,
        y: bottomY + 15,
        size: fontSize,
        font: font,
        color: textColor,
        opacity: 0.9
      });

      // Add download timestamp (bottom right)
      page.drawText(`Downloaded: ${downloadDateString}`, {
        x: bottomX,
        y: bottomY,
        size: fontSize - 1,
        font: font,
        color: textColor,
        opacity: 0.8
      });

      // === TOP RIGHT WATERMARK ===
      const topY = height - margin - 15;

      // Add user info watermark (top right)
      page.drawText(watermarkText, {
        x: bottomX,
        y: topY,
        size: fontSize,
        font: font,
        color: textColor,
        opacity: 0.7
      });

      // === TOP LEFT WATERMARK ===
      page.drawText(`DLSU Access - ${userInfo.name}`, {
        x: margin,
        y: topY,
        size: fontSize - 1,
        font: font,
        color: textColor,
        opacity: 0.6
      });

      // === CENTER DIAGONAL WATERMARK (More Visible) ===
      const centerX = width / 2;
      const centerY = height / 2;
      const diagonalText = `${userInfo.name} - DLSU ACCESS - ${downloadDateString.split(',')[0]}`;

      page.drawText(diagonalText, {
        x: centerX - (font.widthOfTextAtSize(diagonalText, 12) / 2),
        y: centerY,
        size: 12,
        font: font,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.4,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // === ADDITIONAL DIAGONAL WATERMARKS ===
      // Top-left to bottom-right diagonal
      const shortText = `${userInfo.name} - ACCESS`;
      page.drawText(shortText, {
        x: width * 0.25,
        y: height * 0.75,
        size: 10,
        font: font,
        color: rgb(0.88, 0.88, 0.88),
        opacity: 0.35,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Bottom-left to top-right diagonal (opposite angle)
      page.drawText(shortText, {
        x: width * 0.75,
        y: height * 0.75,
        size: 10,
        font: font,
        color: rgb(0.88, 0.88, 0.88),
        opacity: 0.35,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 45
        }
      });

      // Lower diagonal
      page.drawText(`${userInfo.email}`, {
        x: centerX - (font.widthOfTextAtSize(userInfo.email, 9) / 2),
        y: centerY - 50,
        size: 9,
        font: font,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.3,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Repeating pattern - Multiple small diagonals
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const xPos = (width / 4) * (i + 1);
          const yPos = (height / 3) * (j + 1);

          page.drawText(userInfo.name.split(' ')[0] || 'USER', {
            x: xPos - 30,
            y: yPos,
            size: 7,
            font: font,
            color: rgb(0.92, 0.92, 0.92),
            opacity: 0.25,
            rotate: {
              type: RotationTypes.Degrees,
              angle: -45
            }
          });
        }
      }

      // === ADDITIONAL CENTER-ADJACENT DIAGONAL WATERMARKS ===
      // Lower-left from center
      page.drawText(`${userInfo.name.split(' ')[0]}`, {
        x: centerX - 120,
        y: centerY - 80,
        size: 9,
        font: font,
        color: rgb(0.89, 0.89, 0.89),
        opacity: 0.32,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Lower-right from center
      page.drawText(`${userInfo.name.split(' ')[0]}`, {
        x: centerX + 20,
        y: centerY + 100,
        size: 9,
        font: font,
        color: rgb(0.89, 0.89, 0.89),
        opacity: 0.32,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Far lower-left diagonal
      page.drawText(`${userInfo.email.split('@')[0]}`, {
        x: centerX - 160,
        y: centerY - 120,
        size: 8,
        font: font,
        color: rgb(0.91, 0.91, 0.91),
        opacity: 0.28,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Far lower-right diagonal
      page.drawText(`${userInfo.email.split('@')[0]}`, {
        x: centerX + 80,
        y: centerY - 120,
        size: 8,
        font: font,
        color: rgb(0.91, 0.91, 0.91),
        opacity: 0.28,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Mid-left diagonal with reverse angle
      page.drawText(`${userInfo.email.split('@')[0]}`, {
        x: centerX - 200,
        y: centerY + 200,
        size: 8,
        font: font,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.3,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 45  // Opposite angle
        }
      });

      // === LOWER LEFT AND RIGHT WATERMARKS ===
      // Lower left area - diagonal watermarks
      page.drawText(`${userInfo.name.split(' ')[0]} - ACCESS`, {
        x: width * 0.15,
        y: height * 0.25,
        size: 8,
        font: font,
        color: rgb(0.88, 0.88, 0.88),
        opacity: 0.35,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Lower left area - another diagonal
      page.drawText(`${userInfo.email.split('@')[0]}`, {
        x: width * 0.05,
        y: height * 0.35,
        size: 7,
        font: font,
        color: rgb(0.92, 0.92, 0.92),
        opacity: 0.28,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 45
        }
      });

      // Lower left area - straight horizontal
      page.drawText(`DLSU ACCESS - ${userInfo.name.split(' ')[0]}`, {
        x: width * 0.08,
        y: height * 0.2,
        size: 7,
        font: font,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.32,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 0  // Straight horizontal
        }
      });

      // Lower left area - vertical watermark
      page.drawText(`${userInfo.name.split(' ')[0]} - ACCESS`, {
        x: width * 0.02,
        y: height * 0.15,
        size: 6,
        font: font,
        color: rgb(0.93, 0.93, 0.93),
        opacity: 0.25,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 90  // Vertical
        }
      });

      // Lower right area - diagonal watermarks
      page.drawText(`${userInfo.name.split(' ')[0]} - ACCESS`, {
        x: width * 0.75,
        y: height * 0.25,
        size: 8,
        font: font,
        color: rgb(0.88, 0.88, 0.88),
        opacity: 0.35,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 45
        }
      });

      // Lower right area - another diagonal
      page.drawText(`${userInfo.email.split('@')[0]}`, {
        x: width * 0.85,
        y: height * 0.35,
        size: 7,
        font: font,
        color: rgb(0.92, 0.92, 0.92),
        opacity: 0.28,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -45
        }
      });

      // Lower right area - straight horizontal
      page.drawText(`${userInfo.email} - ACCESS`, {
        x: width * 0.55,
        y: height * 0.2,
        size: 7,
        font: font,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.32,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 0  // Straight horizontal
        }
      });

      // Lower right area - vertical watermark
      page.drawText(`${userInfo.email} - ACCESS`, {
        x: width * 0.95,
        y: height * 0.15,
        size: 6,
        font: font,
        color: rgb(0.93, 0.93, 0.93),
        opacity: 0.25,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 90  // Vertical
        }
      });

      // Mid-lower left - additional diagonal
      page.drawText(`${downloadDateString.split(',')[0]}`, {
        x: width * 0.12,
        y: height * 0.3,
        size: 6,
        font: font,
        color: rgb(0.94, 0.94, 0.94),
        opacity: 0.22,
        rotate: {
          type: RotationTypes.Degrees,
          angle: -30
        }
      });

      // Mid-lower right - additional diagonal
      page.drawText(`${downloadDateString.split(',')[0]}`, {
        x: width * 0.78,
        y: height * 0.3,
        size: 6,
        font: font,
        color: rgb(0.94, 0.94, 0.94),
        opacity: 0.22,
        rotate: {
          type: RotationTypes.Degrees,
          angle: 30
        }
      });

      // === ADDITIONAL CORNER WATERMARKS ===
      // Bottom left
      page.drawText(`Page ${index + 1}`, {
        x: margin,
        y: bottomY,
        size: fontSize - 2,
        font: font,
        color: textColor,
        opacity: 0.5
      });
    });

    // Save the modified PDF
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error: unknown) {
    console.error('Error adding watermark to PDF:', error);
    throw new Error('Failed to add watermark');
  }
}