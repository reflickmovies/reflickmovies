import { useNavigate } from 'react-router-dom';
import { Button, LinkButton } from '../components/ui';
import { ROUTES } from '../lib/routes';
import styles from './pages.module.css';

/** 404 for an unknown path. */
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className={styles.notFound ?? ''}>
      <p className={styles.notFoundCode ?? ''}>Error 404</p>
      <h1 className={styles.notFoundTitle ?? ''}>Nothing here</h1>
      <p className={styles.notFoundText ?? ''}>
        That address does not match anything on Reflick. It may have been a title that has not been indexed.
      </p>

      <div className={styles.notFoundActions ?? ''}>
        <LinkButton to={ROUTES.home} variant="primary">
          Back to home
        </LinkButton>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    </div>
  );
}

/**
 * Route-level error boundary fallback. React only renders this when a render throws,
 * so it has to work without any data.
 */
export function RouteErrorPage({ error }: { error: Error }) {
  return (
    <div className={styles.notFound ?? ''}>
      <p className={styles.notFoundCode ?? ''}>Error 500</p>
      <h1 className={styles.notFoundTitle ?? ''}>Something broke</h1>
      <p className={styles.notFoundText ?? ''}>{error.message}</p>
      <LinkButton to={ROUTES.home} variant="primary">
        Back to home
      </LinkButton>
    </div>
  );
}