import { BrowserRouter } from 'react-router-dom';
import { ApolloProvider } from './providers/ApolloProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AppRouter } from './router';
import './styles/global.css';

export function App() {
  return (
    <ThemeProvider>
      <ApolloProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </ApolloProvider>
    </ThemeProvider>
  );
}
