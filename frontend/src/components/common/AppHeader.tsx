import { Image, View } from 'react-native';
import SignOutButton from '@/components/auth/SignOutButton';

type AppHeaderProps = { showSignOut?: boolean };

export default function AppHeader({ showSignOut = false }: AppHeaderProps) {
  return (
    <View className="flex-row items-center justify-between border-b border-zinc-200 bg-white px-5 py-3">
      <Image source={require('frontend/assets/logo.png')} className="h-12 w-40" resizeMode="contain" />
      {showSignOut ? <SignOutButton /> : null}
    </View>
  );
}
