import { Image, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SignOutButton from '@/components/auth/SignOutButton';

type AppHeaderProps = { showSignOut?: boolean };

export default function AppHeader({ showSignOut = false }: AppHeaderProps) {
  // Empuja el header debajo de la barra de estado (hora, bateria, notch).
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center justify-between border-b border-zinc-200 bg-white px-4 pb-3"
      style={{ paddingTop: insets.top + 12 }}
    >
      {/* aspectRatio = proporcion real de logo.png (546x406), para que no quede espacio vacio a los lados */}
      <Image
        source={require('frontend/assets/logo.png')}
        style={{ height: 72, aspectRatio: 546 / 406 }}
        resizeMode="contain"
      />
      {showSignOut ? <SignOutButton /> : null}
    </View>
  );
}
