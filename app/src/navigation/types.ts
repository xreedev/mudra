import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * The app's four destinations, all reached from Home. A flat stack is the right shape here —
 * there is no tab bar because the home tiles *are* the navigation, and a user in a hurry should
 * always be one back-press from them.
 */
export type RootStackParamList = {
  Home: undefined;
  Call: undefined;
  TalkAloud: undefined;
  Receive: undefined;
  Memory: undefined;
  AddSign: undefined;
  Chat: undefined;
};

export type ScreenProps<Route extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Route
>;
