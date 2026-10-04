import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { useT } from '@/i18n';
import messages from '@/i18n/messages/notFound';

export default function NotFound() {
  const { t } = useT(messages);
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">
              404 · {t('title')}
            </h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            {t('body')}
          </p>
          <Link href="/" data-testid="link-not-found-home" className="mt-4 inline-block text-sm font-bold text-[hsl(var(--primary))] underline underline-offset-2">
            {t('home')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
