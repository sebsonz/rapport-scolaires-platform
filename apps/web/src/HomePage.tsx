import { ArrowRight, BarChart3, BookOpen, Building2, CheckCircle2, ClipboardList, GraduationCap, Layers3, Menu, ShieldCheck, Truck, Users, X } from 'lucide-react';
import { useState } from 'react';
import './HomePage.css';

type Props = { onLogin: () => void; onSignup: () => void };

export default function HomePage({ onLogin, onSignup }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  return (
    <main className="public-home">
      <header className="public-header">
        <a className="public-brand" href="#accueil" onClick={closeMenu}>
          <span className="public-brand-icon"><BookOpen size={31}/></span>
          <span><strong>Rapports Scolaires</strong><small>PLATEFORME DE GESTION ET DE SUIVI</small></span>
        </a>
        <button className="public-menu-toggle" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X/> : <Menu/>}</button>
        <nav className={menuOpen ? 'public-nav open' : 'public-nav'}>
          <a className="active" href="#accueil" onClick={closeMenu}>Accueil</a>
          <a href="#apropos" onClick={closeMenu}>À propos</a>
          <a href="#fonctionnalites" onClick={closeMenu}>Fonctionnalités</a>
          <a href="#acteurs" onClick={closeMenu}>Les acteurs</a>
          <button className="public-login" onClick={() => { closeMenu(); onLogin(); }}>Se connecter</button>
          <button className="public-signup" onClick={() => { closeMenu(); onSignup(); }}>Créer un compte <ArrowRight size={16}/></button>
        </nav>
      </header>

      <section className="public-hero" id="accueil">
        <div className="public-hero-copy">
          <span className="public-eyebrow"><ShieldCheck size={15}/> PLATEFORME DE SUIVI SCOLAIRE</span>
          <h1>Les rapports scolaires,<br/><em>en toute simplicité.</em></h1>
          <p>Une plateforme moderne et sécurisée pour organiser l’enrôlement des élèves, la saisie des rapports, le suivi des livraisons et la supervision des activités scolaires.</p>
          <div className="public-hero-actions">
            <button className="public-primary" onClick={onLogin}>Accéder à la plateforme <ArrowRight size={18}/></button>
            <a className="public-secondary" href="#fonctionnalites">Découvrir les fonctionnalités</a>
          </div>
          <div className="public-assurances"><span><CheckCircle2/> Multi-organisations</span><span><CheckCircle2/> Multi-départements</span><span><CheckCircle2/> Accès sécurisé</span></div>
        </div>
        <div className="public-hero-art" aria-label="Illustration de la gestion scolaire">
          <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
          <div className="art-sun"/>
          <div className="art-school"><div className="school-roof"/><div className="school-building"><div className="school-sign"><GraduationCap size={34}/><b>ÉCOLE</b></div><div className="school-windows"><i/><i/><i/><i/><i/><i/></div><div className="school-door"/></div><div className="school-ground"/></div>
          <div className="art-student student-one"><span className="student-head"/><span className="student-body"/><span className="student-book"><BookOpen/></span></div>
          <div className="art-student student-two"><span className="student-head"/><span className="student-body"/><span className="student-book"><BookOpen/></span></div>
          <div className="art-float float-report"><ClipboardList/><span><b>Rapports</b><small>Saisie et validation</small></span></div>
          <div className="art-float float-delivery"><Truck/><span><b>Livraisons</b><small>Suivi & traçabilité</small></span></div>
          <div className="art-caption">Chaque étape scolaire, mieux coordonnée.</div>
        </div>
      </section>

      <section className="public-features" id="fonctionnalites">
        <article className="feature-card feature-blue"><span><Users/></span><div><h3>Enrôlement des élèves</h3><p>Organisation des effectifs par établissement et groupe pédagogique.</p></div></article>
        <article className="feature-card feature-purple"><span><BarChart3/></span><div><h3>Saisie des rapports</h3><p>Renseignez, consultez et suivez les rapports scolaires.</p></div></article>
        <article className="feature-card feature-orange"><span><Truck/></span><div><h3>Bordereaux de livraison</h3><p>Traçabilité des remises et suivi des livraisons.</p></div></article>
        <article className="feature-card feature-green"><span><Layers3/></span><div><h3>Supervision & statistiques</h3><p>Indicateurs consolidés et visibilité sur les activités.</p></div></article>
      </section>

      <section className="public-about" id="apropos">
        <div><span className="public-section-kicker">UNE GESTION PLUS LISIBLE</span><h2>Une vision commune,<br/><em>des responsabilités claires.</em></h2><p>Les informations sont organisées selon les rôles et les périmètres de chaque acteur. Les accès sont contrôlés et les opérations sensibles sont conçues pour être traçables.</p></div>
        <div className="public-principles"><article><ShieldCheck/><b>Accès maîtrisés</b><span>Chaque profil dispose de droits adaptés à ses responsabilités.</span></article><article><Building2/><b>Organisation structurée</b><span>Une gestion coordonnée des organisations, départements et établissements.</span></article><article><ClipboardList/><b>Suivi des opérations</b><span>Des rapports et des livraisons suivis dans un même environnement.</span></article></div>
      </section>

      <section className="public-audience" id="acteurs">
        <div className="audience-intro"><span className="public-section-kicker">UN ESPACE POUR CHAQUE ACTEUR</span><h2>La bonne information,<br/>au bon niveau.</h2><p>Une plateforme pensée pour faciliter la coordination du système scolaire.</p></div>
        <div className="audience-grid"><article><Building2/><b>Administration centrale</b><span>Pilotage et supervision globale</span></article><article><Layers3/><b>Départements</b><span>Coordination et suivi départemental</span></article><article><GraduationCap/><b>Établissements</b><span>Gestion et saisie des rapports</span></article><article><Users/><b>Utilisateurs</b><span>Accès sécurisé selon les rôles</span></article></div>
      </section>

      <section className="public-cta"><div><span>PRÊT À COMMENCER ?</span><h2>Retrouvez votre espace de travail.</h2><p>Connectez-vous pour accéder aux fonctionnalités autorisées pour votre profil.</p></div><button onClick={onLogin}>Se connecter <ArrowRight/></button></section>
      <footer className="public-footer"><a className="public-brand" href="#accueil"><span className="public-brand-icon"><BookOpen/></span><span><strong>Rapports Scolaires</strong><small>PLATEFORME DE GESTION ET DE SUIVI</small></span></a><span>© 2026–2027 · Rapports Scolaires</span><a href="#accueil">Retour en haut ↑</a></footer>
    </main>
  );
}
