// allow importing the JS timetable component without complaints
// this file is picked up automatically by the tsconfig "include": ["src"]

declare module './pages/timetable' {
  const value: any;
  export default value;
}
