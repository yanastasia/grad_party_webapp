# A&L Graduation Party

A mobile-first web app for the **A&L Graduation Party**, combining guest song requests with a browser-based disposable camera experience.

The app is designed to be accessed through a QR code at the event, with no downloads required.

## Features

### Party landing page
Guests scan a QR code and choose between:

- **Song Requests** via Deck.fm
- **Take Photos** via the built-in disposable camera

### Disposable camera
Guests can:

- register with a unique name
- log back in later using the same name
- use the camera directly inside the browser
- switch between front and rear cameras
- see how many shots they have remaining
- take up to **15 photos**
- retake photos without consuming a shot
- optionally add a caption or message
- send photos directly to the event archive

Existing camera-roll photos cannot be uploaded.

### Photo storage
Photos are stored in a Google Workspace Shared Drive.

Structure:

```text
A&L Graduation Party/
├── Originals/
│   ├── Guest Name/
│   │   ├── photo-01.jpg
│   │   └── photo-02.jpg
│   └── ...
│
└── Processed/
    ├── Guest Name/
    └── ...
