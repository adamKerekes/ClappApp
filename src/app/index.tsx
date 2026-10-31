import { Redirect } from 'expo-router';

/** Az app egyetlen képernyője az OBD, a kezdőoldal oda irányít. */
export default function Index() {
  return <Redirect href="/obd" />;
}
