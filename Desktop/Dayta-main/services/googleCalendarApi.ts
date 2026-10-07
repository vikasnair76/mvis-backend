export async function fetchGoogleCalendarProfile(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google profile fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function fetchPrimaryCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );

  url.searchParams.set("timeMin", timeMinIso);
  url.searchParams.set("timeMax", timeMaxIso);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}
export async function fetchPrimaryCalendarEventById(
  accessToken: string,
  eventId: string
) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
  );

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Calendar event fetch failed: ${res.status} ${text}`
    );
  }

  return res.json();
}
