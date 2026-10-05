// The scripted researcher's sources are made-up `.example` hosts: a test fixture, not a backend path (local-only.test.ts).

/** The scripted researcher's dossier: the same two claims as the Rust fake writer. */
export const MVP_RESEARCH = {
  claims: [
    { claim: "The park's information office lists the route as open all year.", url: 'https://www.parco.example/route', title: 'Route information' },
    { claim: 'Trains between the five villages run about every twenty minutes in summer.', url: 'https://www.rail.example/timetable', title: 'Timetable' },
  ],
}

/** The scripted pitch check: every pitch checks out, on a made-up official source. */
export const MVP_PITCH_CHECK = {
  verifiable: true,
  note: "The park's information pages cover it.",
  claims: [{ claim: "The park's information office describes the place and its access.", url: 'https://www.parco.example/info', title: 'Park information' }],
}
