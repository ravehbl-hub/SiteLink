import type { Resources } from './en';

export const tr: Resources = {
  nav: {
    features: 'Özellikler',
    how: 'Nasıl çalışır',
    roles: 'Kimler için',
    contact: 'İletişim',
    login: 'Giriş yap',
    getStarted: 'Başlayın',
    menu: 'Menü',
    language: 'Dil',
  },
  hero: {
    badge: 'Şantiye iş gücü yönetimi',
    title: 'Şantiye ekiplerinizi tek yerden yönetin',
    subtitle:
      'SiteLink tüm şantiyelerinizi bir araya getirir — devam takibi, bordro hesaplama, çalışan taleplerini onaylama ve raporları tek panelden tüm sahalarınızda dışa aktarma.',
    ctaPrimary: 'Başlayın',
    ctaSecondary: 'Demo talep et',
    highlight1: 'Çoklu şantiye',
    highlight2: 'Devam ve bordro',
    highlight3: 'İbranice · İngilizce · Türkçe',
  },
  features: {
    title: 'Ekibi yönetmek için ihtiyacınız olan her şey',
    subtitle: 'İnşaat şirketlerinin gerçekte çalışma biçimine göre tasarlandı.',
    items: {
      multisite: {
        title: 'Çoklu şantiye yönetimi',
        body: 'Çalışanları, ustabaşılarını ve bordroyu her şantiye için düzenleyin — tüm operasyonu tek bakışta görün.',
      },
      attendance: {
        title: 'Çalışan devam takibi',
        body: 'Mevcut, izinli ve raporlu günleri sahada kaydedin; böylece saatler her zaman doğru ve bordroya hazır olur.',
      },
      payroll: {
        title: 'Maaş ve bordro',
        body: 'Çalışma koşullarını ve çalışılan saatleri göz önünde bulundurarak saatlik veya sabit ücretten maaş hesaplayın.',
      },
      requests: {
        title: 'Talep akışı',
        body: 'Çalışanlar kredi, avans ve izin talebi oluşturur; yöneticiler onaylar veya reddeder — durum değişince kararı yeniden verebilir.',
      },
      apps: {
        title: 'Ustabaşı ve çalışan uygulamaları',
        body: 'Ustabaşılar şantiyelerindeki devamı yönetir; çalışanlar saatlerini, maaşlarını ve taleplerini telefondan görür.',
      },
      admin: {
        title: 'Sistem Yöneticisi konsolu',
        body: 'Tüm şirketler genelinde müşteriler, faturalandırma ve platform denetimi için özel bir konsol.',
      },
      reports: {
        title: 'PDF raporlar',
        body: 'Bordro, çalışma saatleri, devam ve kâr-zarar raporlarını temiz, paylaşılabilir PDF olarak dışa aktarın.',
      },
      staffing: {
        title: 'İnsan kaynağı şirketleri',
        body: 'Personel (istihdam) şirketlerini ve sahalarınıza sağladıkları çalışanları modelleyin.',
      },
      roles: {
        title: 'Çok rollü erişim',
        body: 'Yönetici, Müdür, Ustabaşı ve Çalışan için kapsamlı izinler — herkes tam olarak görmesi gerekeni görür.',
      },
      i18n: {
        title: 'İbranice, RTL ve çok dilli',
        body: 'Tam sağdan-sola desteğiyle önce İbranice, ayrıca kutudan çıkar çıkmaz İngilizce ve Türkçe.',
      },
    },
  },
  how: {
    title: 'SiteLink nasıl çalışır',
    subtitle: 'Kurulumdan bordroya beş adımda.',
    steps: {
      s1: { title: 'Şantiyelerinizi kurun', body: 'Her şantiyeyi oluşturun ve ayrıntılarını tanımlayın.' },
      s2: { title: 'Çalışan ekleyin', body: 'Çalışanlarınızı ekleyin ve her birine kendi girişini verin.' },
      s3: { title: 'Sahada devam kaydı', body: 'Ustabaşılar her gün kimin mevcut, izinli veya raporlu olduğunu kaydeder.' },
      s4: { title: 'Onaylayın ve bordro işleyin', body: 'Yöneticiler talepleri onaylar ve saatlerden maaşları hesaplar.' },
      s5: { title: 'Raporları dışa aktarın', body: 'Bordroları ve yönetim raporlarını PDF olarak oluşturun.' },
    },
  },
  roles: {
    title: 'Sahadaki her rol için tasarlandı',
    subtitle: 'Herkes yaptığı işe göre uyarlanmış bir yüzey alır.',
    items: {
      manager: {
        name: 'Yönetici',
        surface: 'Web',
        body: 'Tüm şirket için şantiyeleri, çalışanları, bordroyu, talepleri ve raporları yönetin.',
      },
      foreman: {
        name: 'Ustabaşı',
        surface: 'Mobil uygulama',
        body: 'Devam kaydı tutar ve kendi çalışanlarını yönetir — atandığı şantiyelerle sınırlı.',
      },
      worker: {
        name: 'Çalışan',
        surface: 'Mobil uygulama',
        body: 'Saatlerimi, maaşımı görürüm ve kendi taleplerimi oluştururum — hepsi telefonumdan.',
      },
      admin: {
        name: 'Sistem Yöneticisi',
        surface: 'Web',
        body: 'Tüm şirketler genelinde müşterileri, faturalandırmayı ve platformu denetler.',
      },
    },
  },
  contact: {
    title: 'SiteLink’i iş başında görmeye hazır mısınız?',
    subtitle: 'Bize ekiplerinizden bahsedin, size bir demo ayarlayalım.',
    name: 'Adınız',
    email: 'E-posta',
    message: 'Size nasıl yardımcı olabiliriz?',
    send: 'Mesaj gönder',
    note: 'Bu form e-posta uygulamanızı açar — hesap gerekmez.',
    or: 'Ya da doğrudan bize yazın',
  },
  footer: {
    tagline: 'Sahadan bordroya inşaat iş gücü yönetimi.',
    sections: 'Keşfet',
    contact: 'İletişim',
    rights: 'Tüm hakları saklıdır.',
  },
};
