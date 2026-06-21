import { ConfigProvider, theme } from 'antd';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorBgBase: '#141414',
          borderRadius: 4,
          fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace, sans-serif`,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
