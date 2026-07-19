import { Header } from './components/Header';
import { Hero } from './sections/Hero';
import { Features } from './sections/Features';
import { HowItWorks } from './sections/HowItWorks';
import { Roles } from './sections/Roles';
import { Contact } from './sections/Contact';
import { Footer } from './sections/Footer';

export function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Roles />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
