import './globals.css';
import './camera-controls.css';

export const metadata = {
  title: 'A&L Graduation Party',
  description: 'A&L Graduation Party guest activities',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
