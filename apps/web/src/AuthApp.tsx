import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, GraduationCap, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import AdminDashboard from './AdminDashboard';

type View = 'LOGIN' | 'SIGNUP';

export default function AuthApp() {
  const { session, profile, accessRequest, memberships, loading, accessError, signIn, signUp, signOut } = useAuth();
  const [view, setView] = useState<View>('LOGIN');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (view === 'SIGNUP') {
      if (password.length < 8) {
        setError('Le mot de passe doit contenir au moins 8 caractères.');
        return;
      }
      if (password !== confirmation) {
        setError('Les deux mots de passe ne correspondent pas.');
        return;
      }
    }

    setBusy(true);
    try {
      if (view === 'SIGNUP') {
        await signUp(fullName, email, password);
        setMessage('Votre demande de création de compte a été enregistrée. Consultez votre boîte mail et cliquez sur le lien de confirmation pour vérifier votre adresse. Après confirmation, votre accès restera en attente de validation administrative.');
      } else {
        await signIn(email, password);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Une erreur est survenue. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="auth-page"><section className="auth-card auth-loading">Vérification de votre session…</section></main>;
  }

  if (session) {
    if (accessError) {
      return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-alert error">{accessError}</div><button className="auth-primary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
    }

    if (!accessRequest) {
      return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-alert error">La demande d’accès de ce compte est introuvable. Contacte l’administration centrale.</div><button className="auth-primary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
    }

    if (accessRequest.status === 'PENDING') {
      return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-status-icon pending"><Mail/></div><h1>Adresse vérifiée</h1><p className="auth-subtitle">Bonjour {profile?.full_name ?? ''}, ton compte est créé. Il attend maintenant la validation de l’administration centrale.</p><div className="auth-alert info">Tu recevras les instructions nécessaires lorsque ton accès aura été examiné. Aucun département ni rôle ne t’est attribué automatiquement.</div><button className="auth-secondary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
    }

    if (accessRequest.status === 'REJECTED') {
      return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-status-icon rejected"><ShieldCheck/></div><h1>Demande non approuvée</h1><p className="auth-subtitle">L’administration n’a pas approuvé cette demande d’accès.</p>{accessRequest.review_note && <div className="auth-alert info">{accessRequest.review_note}</div>}<button className="auth-secondary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
    }

    if (memberships.some(membership => membership.role === 'CENTRAL_ADMIN')) {
      return <AdminDashboard profile={profile} onSignOut={() => void signOut()} />;
    }

    if (memberships.length === 0) {
      return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-status-icon pending"><CheckCircle2/></div><h1>Validation effectuée</h1><p className="auth-subtitle">Ton compte est approuvé, mais aucune affectation à un département ne lui est encore associée. Contacte l’administration centrale.</p><button className="auth-secondary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
    }

    return <main className="auth-page"><section className="auth-card"><AuthBrand/><div className="auth-status-icon approved"><CheckCircle2/></div><h1>Accès autorisé</h1><p className="auth-subtitle">Bonjour {profile?.full_name ?? ''}. Ton compte est validé et possède {memberships.length} affectation(s).</p><div className="auth-alert info">L’espace de travail sera raccordé aux données réelles dans le prochain lot. Aucune donnée de démonstration ne sera affichée.</div><button className="auth-secondary" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <AuthBrand/>
        <div className="auth-year">ANNÉE SCOLAIRE 2026 — 2027</div>
        <h1>{view === 'LOGIN' ? 'Bienvenue' : 'Créer un compte'}</h1>
        <p className="auth-subtitle">{view === 'LOGIN' ? 'Connecte-toi pour accéder à ton espace de travail.' : 'Crée ton compte pour demander un accès à la plateforme.'}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {view === 'SIGNUP' && <label><span>Nom et prénoms</span><div className="auth-input"><UserRound/><input autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Ton nom complet" required minLength={2}/></div></label>}
          <label><span>Adresse email</span><div className="auth-input"><Mail/><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="nom@exemple.com" required/></div></label>
          <label><span>Mot de passe</span><div className="auth-input"><LockKeyhole/><input type="password" autoComplete={view === 'LOGIN' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="8 caractères minimum" required minLength={8}/></div></label>
          {view === 'SIGNUP' && <label><span>Confirmer le mot de passe</span><div className="auth-input"><LockKeyhole/><input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="Répète ton mot de passe" required minLength={8}/></div></label>}
          {error && <div className="auth-alert error" role="alert">{error}</div>}
          {message && <div className="auth-alert success" role="status">{message}</div>}
          <button className="auth-primary" type="submit" disabled={busy}>{busy ? 'Patiente…' : view === 'LOGIN' ? 'Se connecter' : 'Créer mon compte'} <ArrowRight/></button>
        </form>

        <div className="auth-switch">
          {view === 'LOGIN' ? 'Tu n’as pas encore de compte ?' : 'Tu as déjà un compte ?'}
          <button type="button" onClick={() => { setView(view === 'LOGIN' ? 'SIGNUP' : 'LOGIN'); setError(''); setMessage(''); }}>
            {view === 'LOGIN' ? 'Créer un compte' : 'Se connecter'}
          </button>
        </div>
        {view === 'SIGNUP' && <p className="auth-footnote">Après ton inscription, tu devras confirmer ton adresse email. L’accès à la plateforme sera ensuite soumis à l’approbation de l’administration centrale.</p>}
      </section>
    </main>
  );
}

function AuthBrand() {
  return <div className="auth-brand"><div className="auth-brand-icon"><GraduationCap/></div><div><strong>Rapports Scolaires</strong><span>PLATEFORME DE GESTION</span></div></div>;
}
