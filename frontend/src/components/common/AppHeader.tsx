import { Image, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SignOutButton from '@/components/auth/SignOutButton';

type AppHeaderProps = { showSignOut?: boolean };

export default function AppHeader({ showSignOut = false }: AppHeaderProps) {
  // Empuja el header debajo de la barra de estado (hora, bateria, notch).
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center justify-between border-b border-zinc-200 bg-white px-5 pb-3"
      style={{ paddingTop: insets.top + 12 }}
    >
      <Image source={require('frontend/assets/logo.png')} className="h-12 w-40" resizeMode="contain" />
      {showSignOut ? <SignOutButton /> : null}
    </View>
  );
}
