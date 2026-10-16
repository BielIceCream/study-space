import { createRoot } from 'react-dom/client';
import './fonts.css';
import './styles.css';
import App from './App';
import { createStorage } from './services/storage';
import { messageFrom } from './shared/utils';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="startup-screen"><span className="startup-dot" /><p>Abrindo seu espaço de estudo…</p></div>);
void createStorage().then(storage => root.render(<App storage={storage} />)).catch(error => {
  root.render(<div className="startup-screen"><h1>Seu espaço precisa de atenção</h1><p role="alert">{messageFrom(error)}</p><p>Seus dados foram preservados. Verifique o armazenamento disponível e tente novamente.</p><button className="button primary" onClick={() => window.location.reload()}>Tentar novamente</button></div>);
});
