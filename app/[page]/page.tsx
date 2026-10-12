import { notFound } from 'next/navigation';
import { Portfolio, Orders, History, WalletPage, SettingsPage } from '@/components/account-pages';
import Markets from '@/components/markets';
import AuthForm from '@/components/auth-form';
const pages = {
  portfolio: Portfolio,
  orders: Orders,
  history: History,
  wallet: WalletPage,
  settings: SettingsPage,
  markets: Markets,
};
export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: page.charAt(0).toUpperCase() + page.slice(1) };
}
export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (page === 'login' || page === 'register') return <AuthForm register={page === 'register'} />;
  const Component = pages[page as keyof typeof pages];
  if (!Component) notFound();
  return <Component />;
}
